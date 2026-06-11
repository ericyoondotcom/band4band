import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

function normalizeCategory(categoryStr) {
  if (!categoryStr) return '';
  return categoryStr
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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
      const incomeSources = [];
      const recentPurchases = [];

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 14); // Changed to 2 weeks
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

        // Get Transactions (14 days for spending/purchases)
        const transactionsResponse = await this.client.transactionsGet({
          access_token: token,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        });

        // Get Income Transactions (60 days — paychecks may not come every 2 weeks)
        const incomeStartDate = new Date();
        incomeStartDate.setDate(incomeStartDate.getDate() - 60);
        const incomeResponse = await this.client.transactionsGet({
          access_token: token,
          start_date: incomeStartDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        });

        // Process spending/purchases (require merchant_name for quality)
        transactionsResponse.data.transactions.forEach(tx => {
          if (!tx.merchant_name) return;

          if (tx.amount > 0) {
            let category = 'General';
            if (tx.personal_finance_category && tx.personal_finance_category.detailed) {
              category = tx.personal_finance_category.detailed;
            } else if (tx.category && tx.category.length > 0) {
              category = tx.category[0];
            }
            
            if (!category.toUpperCase().includes('GENERAL')) {
              const cleanCategory = normalizeCategory(category);
              spendingCategories[cleanCategory] = (spendingCategories[cleanCategory] || 0) + tx.amount;
            }
            recentPurchases.push({ name: tx.merchant_name, amount: tx.amount });
          }
        });

        // Process income separately — use tx.name as fallback since payroll often lacks merchant_name
        incomeResponse.data.transactions.forEach(tx => {
          if (tx.amount < 0) {
            let sourceName = tx.merchant_name || tx.name;
            if (sourceName) {
              // Strip numbers from statement names so the LLM doesn't misinterpret them as dollar amounts
              sourceName = sourceName.replace(/\d+/g, '').trim();
              if (sourceName.length > 0) {
                incomeSources.push({ name: sourceName, amount: Math.abs(tx.amount) });
              }
            }
          }
        });
      });

      await Promise.all(promises);

      // Sort categories and purchases
      const topCategories = Object.entries(spendingCategories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5) // Top 5 categories
        .map(entry => ({ category: entry[0], amount: entry[1] }));
      
      // Randomly sample 5 purchases
      const randomPurchases = recentPurchases
        .sort(() => 0.5 - Math.random())
        .slice(0, 5);

      // Deduplicate income sources: group by name, sum amounts, take top 3 unique sources
      const incomeByName = {};
      incomeSources.forEach(({ name, amount }) => {
        incomeByName[name] = (incomeByName[name] || 0) + amount;
      });
      const topIncome = Object.entries(incomeByName)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);

      return {
        netWorth: Math.round(netWorth),
        recentPurchases: randomPurchases,
        incomeSources: topIncome,
        spendingCategories: topCategories,
      };

    } catch (error) {
      console.error("Plaid getFinancialData error:", error.response?.data || error.message);
      // Fallback data in case of error so game doesn't crash
      return {
        netWorth: 0,
        recentPurchases: [{ name: 'Nothing', amount: 0 }],
        incomeSources: ['Unemployed'],
        spendingCategories: [{ category: 'Nothing', amount: 0 }],
      };
    }
  }
}

export default PlaidService.getInstance();
