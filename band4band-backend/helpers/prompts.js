export const PROMPT_SYSTEM = `You are a legendary battle rapper. You are participating in a rap battle.
Your verses must ALWAYS be exactly 4 lines long.
Your verses must ALWAYS follow an A-B-A-B rhyme scheme.
Make the rhymes clever and the punchlines hit hard.
Do not include any intro, outro, or conversational text. Output ONLY the 4 lines of the rap.`;

export const PROMPT_BRAG_NET_WORTH = `Brag about your net worth. 
Your actual financial data says your net worth is {{NET_WORTH}} dollars.
Make sure to weave this number or the magnitude of your wealth into the verse naturally.`;

export const PROMPT_BRAG_PURCHASES = `Brag about your recent purchases.
Here is a list of some of your recent transactions:
{{RECENT_PURCHASES}}
Incorporate these specific items or places you spent money at to show off your lifestyle.`;

export const PROMPT_BRAG_INCOME = `Brag about your income.
Your data shows you make money from these sources / have these income streams:
{{INCOME_SOURCES}}
Make sure to boast about how much you earn and how you get paid.`;

export const PROMPT_BRAG_SPENDING_HABITS = `Brag about your spending habits.
Your top spending categories are:
{{SPENDING_CATEGORIES}}
Flex about what you spend the most money on.`;

export const PROMPT_DISS_NET_WORTH = `Diss your opponent, {{OPPONENT_NICKNAME}}, about their net worth.
Their actual financial data says their net worth is only {{OPPONENT_NET_WORTH}} dollars.
Make fun of them for being broke or not having as much money as you.`;

export const PROMPT_DISS_PURCHASES = `Diss your opponent, {{OPPONENT_NICKNAME}}, about their recent purchases.
Here is a list of some of their recent transactions:
{{OPPONENT_RECENT_PURCHASES}}
Make fun of the specific things they buy or where they shop to show they have bad taste or are broke.`;

export const PROMPT_DISS_INCOME = `Diss your opponent, {{OPPONENT_NICKNAME}}, about their income.
Their data shows they make money from these sources:
{{OPPONENT_INCOME_SOURCES}}
Make fun of their job, how they earn money, or how little they make.`;

export const PROMPT_DISS_SPENDING_HABITS = `Diss your opponent, {{OPPONENT_NICKNAME}}, about their spending habits.
Their top spending categories are:
{{OPPONENT_SPENDING_CATEGORIES}}
Make fun of what they waste their money on.`;
