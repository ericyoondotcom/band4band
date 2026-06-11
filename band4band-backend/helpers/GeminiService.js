import { GoogleGenAI } from '@google/genai';
import { PROMPT_SYSTEM } from './prompts.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parses the retry delay from a Gemini RESOURCE_EXHAUSTED error.
 * Handles formats like:
 *   "Please retry in 49.171805956s."
 *   "retryDelay":"49s"
 *   "Try again in 30 seconds"
 */
function parseRetryDelay(errorMessage) {
  if (!errorMessage) return null;

  // Match "retry in X.Xs" or "retry in Xs"
  const retryInMatch = errorMessage.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (retryInMatch) {
    return Math.ceil(parseFloat(retryInMatch[1])) * 1000;
  }

  // Match "retryDelay":"Xs"
  const retryDelayMatch = errorMessage.match(/retryDelay["\s:]+(\d+(?:\.\d+)?)\s*s/i);
  if (retryDelayMatch) {
    return Math.ceil(parseFloat(retryDelayMatch[1])) * 1000;
  }

  // Match "try again in X seconds"
  const tryAgainMatch = errorMessage.match(/try again in (\d+)/i);
  if (tryAgainMatch) {
    return parseInt(tryAgainMatch[1], 10) * 1000;
  }

  return null;
}

async function executeWithRetry(apiCall, maxRetries = 6) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      const isExhausted = 
        error?.status === 'RESOURCE_EXHAUSTED' || 
        error?.status === 429 || 
        (error?.message && error.message.includes('RESOURCE_EXHAUSTED')) ||
        (error?.message && error.message.includes('429'));

      if (isExhausted) {
        if (i === maxRetries - 1) throw error;
        
        // Try to parse the server-specified delay; fall back to exponential backoff
        const serverDelay = parseRetryDelay(error.message);
        const backoff = 5000 * Math.pow(2, i); // 5s, 10s, 20s, 40s, 80s, 160s
        const delayMs = serverDelay || backoff;
        
        console.warn(`[Gemini API] RESOURCE_EXHAUSTED (attempt ${i + 1}/${maxRetries}). Server says wait ${serverDelay ? (serverDelay / 1000) + 's' : 'N/A'}.`);
        
        // If the server asks us to wait more than 60 seconds (e.g. daily quota hit), fail immediately rather than hanging the server.
        if (delayMs > 60000) {
           console.error(`[Gemini API] Wait time of ${delayMs}ms is too long. Failing fast. (Raw error: ${error.message})`);
           throw new Error(`Rate limit exceeded. Server requested a wait of ${Math.round(delayMs/1000)}s.`);
        }

        console.warn(`[Gemini API] Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Converts raw PCM L16 base64 data to a WAV data URI that browsers can play.
 * @param {string} base64Pcm - Raw PCM data encoded as base64.
 * @param {number} sampleRate - Sample rate (e.g. 24000).
 * @param {number} numChannels - Number of channels (e.g. 1).
 * @param {number} bitsPerSample - Bits per sample (e.g. 16).
 * @returns {string} A data URI with audio/wav mime type.
 */
function pcmToWavDataUri(base64Pcm, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const pcmBytes = Buffer.from(base64Pcm, 'base64');
  const dataLength = pcmBytes.length;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // WAV header is 44 bytes
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20);             // AudioFormat (PCM = 1)
  header.writeUInt16LE(numChannels, 22);   // NumChannels
  header.writeUInt32LE(sampleRate, 24);    // SampleRate
  header.writeUInt32LE(byteRate, 28);      // ByteRate
  header.writeUInt16LE(blockAlign, 32);    // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);    // Subchunk2Size

  const wavBuffer = Buffer.concat([header, pcmBytes]);
  const wavBase64 = wavBuffer.toString('base64');

  return `data:audio/wav;base64,${wavBase64}`;
}

class GeminiService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  static getInstance() {
    if (!GeminiService.instance) {
      GeminiService.instance = new GeminiService();
    }
    return GeminiService.instance;
  }

  /**
   * Generates a 4-line verse using the provided prompt.
   * @param {string} prompt The populated string template prompt.
   * @returns {Promise<string>} The generated verse.
   */
  async generateVerse(prompt) {
    try {
      const response = await executeWithRetry(() => this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: PROMPT_SYSTEM,
          temperature: 0.9,
        }
      }));
      return response.text;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return "Error generating verse.\nError generating verse.\nError generating verse.\nError generating verse.";
    }
  }

  /**
   * Generates all 16 verses in parallel.
   * @param {string[]} player1Prompts Array of 8 prompts for Player 1.
   * @param {string[]} player2Prompts Array of 8 prompts for Player 2.
   * @param {Function} onProgress Callback invoked when a verse finishes generating.
   * @returns {Promise<{player1Verses: string[], player2Verses: string[]}>}
   */
  async generateAllVerses(player1Prompts, player2Prompts, onProgress) {
    const wrapPromise = (p) => p.then(res => {
      if (onProgress) onProgress();
      return res;
    });

    const player1Promises = player1Prompts.map(p => wrapPromise(this.generateVerse(p)));
    const player2Promises = player2Prompts.map(p => wrapPromise(this.generateVerse(p)));

    const [player1Verses, player2Verses] = await Promise.all([
      Promise.all(player1Promises),
      Promise.all(player2Promises)
    ]);

    return { player1Verses, player2Verses };
  }

  /**
   * Generates audio for an entire verse using Gemini Audio Generation.
   * Returns a browser-playable WAV data URI.
   * @param {string} text The text to speak.
   * @param {string} voiceName The prebuilt voice name (e.g., 'Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir').
   * @returns {Promise<string|null>} WAV data URI or null on failure.
   */
  async generateAudioForVerse(text, voiceName = 'Aoede', ttsPrompt = '') {
    try {
      // Per Gemini TTS docs: steer voice by prepending the voice direction
      // prompt directly to the transcript. systemInstruction is NOT supported.
      const fullText = ttsPrompt ? `${ttsPrompt}${text}` : text;

      const response = await executeWithRetry(() => this.ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: fullText }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }));

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData || !inlineData.data) {
        console.error('[GeminiService] No inlineData in TTS response');
        return null;
      }

      // Parse sample rate and channels from the mimeType string
      // e.g. "audio/l16; rate=24000; channels=1"
      const mimeType = inlineData.mimeType || '';
      console.log(`[GeminiService] TTS response mimeType: ${mimeType}`);

      let sampleRate = 24000;
      let numChannels = 1;

      const rateMatch = mimeType.match(/rate=(\d+)/);
      if (rateMatch) sampleRate = parseInt(rateMatch[1], 10);

      const channelsMatch = mimeType.match(/channels=(\d+)/);
      if (channelsMatch) numChannels = parseInt(channelsMatch[1], 10);

      // Convert raw PCM L16 to WAV so browsers can play it
      return pcmToWavDataUri(inlineData.data, sampleRate, numChannels, 16);
    } catch (error) {
      console.error("Gemini Audio Error:", error);
      return null;
    }
  }
}

export default GeminiService.getInstance();
