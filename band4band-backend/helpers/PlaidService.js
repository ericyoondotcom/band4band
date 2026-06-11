import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

class PlaidService {
  constructor() {
    const configuration = new Configuration({
      basePath: PlaidEnvironments.production, // User specified production environment
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    });
    this.client = new PlaidApi(configuration);
  }

  static getInstance() {
    if (!PlaidService.instance) {
      PlaidService.instance = new PlaidService();
    }
    return PlaidService.instance;
  }

  /**
   * Creates a link token for a user.
   * @returns {Promise<string>} The link token.
   */
  async createLinkToken(clientUserId) {
    try {
      const response = await this.client.linkTokenCreate({
        user: { client_user_id: clientUserId },
        client_name: 'Band4Band',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      });
      return response.data.link_token;
    } catch (error) {
      console.error("Plaid createLinkToken error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Exchanges a public token for an access token.
   * @param {string} publicToken 
   * @returns {Promise<string>} The access token.
   */
  async exchangePublicToken(publicToken) {
    try {
      const response = await this.client.itemPublicTokenExchange({
        public_token: publicToken,
      });
      return response.data.access_token;
    } catch (error) {
      console.error("Plaid exchangePublicToken error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetches financial data (balance, recent transactions, income sources, spending categories)
   * for given access tokens.
   * @param {string[]} accessTokens 
   */
  async getFinancialData(accessTokens) {
    try {
      let netWorth = 0;
      const spendingCategories = {};
      const incomeSources = new Set();
      const recentPurchases = [];

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();
      
      const promises = accessTokens.map(async (token) => {
        // Get Accounts
        const accountsResponse = await this.client.accountsGet({
          access_token: token,
        });
        
        accountsResponse.data.accounts.forEach(acc => {
          if (acc.type === 'depository' || acc.type === 'investment') {
            netWorth += acc.balances.current || 0;
          } else if (acc.type === 'credit' || acc.type === 'loan') {
            netWorth -= acc.balances.current || 0;
          }
        });

        // Get Transactions
        const transactionsResponse = await this.client.transactionsGet({
          access_token: token,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        });

        transactionsResponse.data.transactions.forEach(tx => {
          if (tx.amount > 0) {
            // Spending
            const category = tx.category ? tx.category[0] : 'General';
            spendingCategories[category] = (spendingCategories[category] || 0) + tx.amount;
            recentPurchases.push({ name: tx.name, amount: tx.amount });
          } else if (tx.amount < 0) {
            // Income
            incomeSources.add(tx.name);
          }
        });
      });

      await Promise.all(promises);

      // Sort categories and purchases
      const topCategories = Object.entries(spendingCategories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);
      
      const topPurchases = recentPurchases
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(p => p.name);

      return {
        netWorth: Math.round(netWorth),
        recentPurchases: topPurchases,
        incomeSources: Array.from(incomeSources).slice(0, 3),
        spendingCategories: topCategories,
      };

    } catch (error) {
      console.error("Plaid getFinancialData error:", error.response?.data || error.message);
      // Fallback data in case of error so game doesn't crash
      return {
        netWorth: 0,
        recentPurchases: ['Nothing'],
        incomeSources: ['Unemployed'],
        spendingCategories: ['Nothing'],
      };
    }
  }
}

export default PlaidService.getInstance();
