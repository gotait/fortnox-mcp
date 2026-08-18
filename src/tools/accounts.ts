import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fortnoxRequest, fetchAllPages } from "../services/api.js";
import { ResponseFormat } from "../constants.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatBoolean,
  formatListMarkdown,
  formatDetailMarkdown,
  buildPaginationMeta
} from "../services/formatters.js";
import {
  ListAccountsSchema,
  GetAccountSchema,
  CreateAccountSchema,
  UpdateAccountSchema,
  DeleteAccountSchema,
  ListAccountsOutputSchema,
  GetAccountOutputSchema,
  MutateAccountOutputSchema,
  DeleteAccountOutputSchema,
  type ListAccountsOutput,
  type GetAccountOutput,
  type MutateAccountOutput,
  type DeleteAccountOutput,
  type ListAccountsInput,
  type GetAccountInput,
  type CreateAccountInput,
  type UpdateAccountInput,
  type DeleteAccountInput
} from "../schemas/accounts.js";

// API response types
interface FortnoxAccount {
  Number: number;
  Description: string;
  Active?: boolean;
  VATCode?: string;
  BalanceBroughtForward?: number;
  BalanceCarriedForward?: number;
  CostCenterSettings?: string;
  ProjectSettings?: string;
  SRU?: number;
  Year?: number;
  "@url"?: string;
}

interface FortnoxAccountListItem {
  Number: number;
  Description: string;
  Active?: boolean;
  "@url"?: string;
}

interface AccountListResponse {
  Accounts: FortnoxAccountListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface AccountResponse {
  Account: FortnoxAccount;
}

/**
 * Register all account-related tools
 */
export function registerAccountTools(server: McpServer): void {
  // List accounts
  server.registerTool(
    "fortnox_list_accounts",
    {
      title: "List Fortnox Accounts",
      description: `List accounts from the chart of accounts in Fortnox.

Retrieves a paginated list of accounts with optional filtering.

Note: The Fortnox API does not support these filters, so search_description,
from_account, and to_account are applied client-side: all accounts are fetched
first, then filtered and paginated locally.

Args:
  - limit (number): Max results per page, 1-100 (default: 20)
  - page (number): Page number for pagination (default: 1)
  - search_description (string): Search accounts by description, case-insensitive substring (client-side)
  - from_account (number): Filter accounts from this number, 1000-9999 (client-side)
  - to_account (number): Filter accounts to this number, 1000-9999 (client-side)
  - response_format ('markdown' | 'json'): Output format

Returns:
  List of accounts with account number, description, and active status.

Examples:
  - List revenue accounts: from_account=3000, to_account=3999
  - List expense accounts: from_account=4000, to_account=8999`,
      inputSchema: ListAccountsSchema,
      outputSchema: ListAccountsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListAccountsInput) => {
      try {
        const hasClientFilters =
          params.search_description !== undefined ||
          params.from_account !== undefined ||
          params.to_account !== undefined;

        let accounts: FortnoxAccountListItem[];
        let total: number;
        let truncated = false;
        let truncationReason: string | undefined;

        if (hasClientFilters) {
          // The Fortnox API does not support these filters, so fetch all
          // accounts and filter client-side.
          const result = await fetchAllPages<FortnoxAccountListItem, AccountListResponse>(
            "/3/accounts",
            {},
            (r) => r.Accounts || [],
            (r) => r.MetaInformation?.["@TotalResources"] || 0
          );
          truncated = result.truncated;
          truncationReason = result.truncationReason;

          let filtered = result.items;
          if (params.search_description !== undefined) {
            const needle = params.search_description.toLowerCase();
            filtered = filtered.filter((a) => (a.Description || "").toLowerCase().includes(needle));
          }
          if (params.from_account !== undefined) {
            filtered = filtered.filter((a) => a.Number >= params.from_account!);
          }
          if (params.to_account !== undefined) {
            filtered = filtered.filter((a) => a.Number <= params.to_account!);
          }

          total = filtered.length;
          const start = (params.page - 1) * params.limit;
          accounts = filtered.slice(start, start + params.limit);
        } else {
          const queryParams: Record<string, string | number | boolean | undefined> = {
            limit: params.limit,
            page: params.page
          };

          const response = await fortnoxRequest<AccountListResponse>("/3/accounts", "GET", undefined, queryParams);
          accounts = response.Accounts || [];
          total = response.MetaInformation?.["@TotalResources"] || accounts.length;
        }

        const output: ListAccountsOutput = {
          ...buildPaginationMeta(total, params.page, params.limit, accounts.length),
          ...(truncated ? { truncated, truncation_reason: truncationReason } : {}),
          accounts: accounts.map((a) => ({
            account_number: a.Number,
            description: a.Description,
            active: a.Active ?? true
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatListMarkdown(
            "Chart of Accounts",
            accounts,
            total,
            params.page,
            params.limit,
            (a) => `- **${a.Number}**: ${a.Description}${a.Active === false ? " *(inactive)*" : ""}`
          );
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get single account
  server.registerTool(
    "fortnox_get_account",
    {
      title: "Get Fortnox Account",
      description: `Retrieve detailed information about a specific account.

Args:
  - account_number (number): The account number to retrieve (1000-9999, required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Complete account details including description, VAT settings, and balances.`,
      inputSchema: GetAccountSchema,
      outputSchema: GetAccountOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetAccountInput) => {
      try {
        const response = await fortnoxRequest<AccountResponse>(
          `/3/accounts/${params.account_number}`
        );
        const account = response.Account;

        const output: GetAccountOutput = {
          account_number: account.Number,
          description: account.Description,
          active: account.Active ?? true,
          vat_code: account.VATCode || null,
          balance_brought_forward: account.BalanceBroughtForward || 0,
          balance_carried_forward: account.BalanceCarriedForward || 0,
          cost_center_settings: account.CostCenterSettings || null,
          project_settings: account.ProjectSettings || null,
          sru_code: account.SRU || null,
          year: account.Year || null
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatDetailMarkdown(`Account ${account.Number}`, [
            { label: "Account Number", value: account.Number },
            { label: "Description", value: account.Description },
            { label: "Active", value: account.Active },
            { label: "VAT Code", value: account.VATCode },
            { label: "Opening Balance", value: account.BalanceBroughtForward },
            { label: "Closing Balance", value: account.BalanceCarriedForward },
            { label: "Cost Center", value: account.CostCenterSettings },
            { label: "Project", value: account.ProjectSettings },
            { label: "SRU Code", value: account.SRU }
          ]);
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Create account
  server.registerTool(
    "fortnox_create_account",
    {
      title: "Create Fortnox Account",
      description: `Create a new account in the chart of accounts.

Args:
  - account_number (number): Account number 1000-9999 (required)
  - description (string): Account description (required)
  - vat_code (string): VAT code for the account
  - active (boolean): Whether the account is active (default: true)
  - cost_center_settings ('ALLOWED' | 'MANDATORY' | 'NOTALLOWED'): Cost center settings
  - project_settings ('ALLOWED' | 'MANDATORY' | 'NOTALLOWED'): Project settings
  - sru_code (number): SRU code for tax reporting
  - response_format ('markdown' | 'json'): Output format

Returns:
  The created account details.`,
      inputSchema: CreateAccountSchema,
      outputSchema: MutateAccountOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateAccountInput) => {
      try {
        const accountData: Record<string, unknown> = {
          Number: params.account_number,
          Description: params.description
        };

        if (params.vat_code) accountData.VATCode = params.vat_code;
        if (params.active !== undefined) accountData.Active = params.active;
        if (params.cost_center_settings) accountData.CostCenterSettings = params.cost_center_settings;
        if (params.project_settings) accountData.ProjectSettings = params.project_settings;
        if (params.sru_code !== undefined) accountData.SRU = params.sru_code;

        const response = await fortnoxRequest<AccountResponse>(
          "/3/accounts",
          "POST",
          { Account: accountData }
        );
        const account = response.Account;

        const output: MutateAccountOutput = {
          success: true,
          message: `Account ${account.Number} created successfully`,
          account_number: account.Number,
          description: account.Description
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Account Created\n\n` +
            `**Account Number**: ${account.Number}\n` +
            `**Description**: ${account.Description}\n\n` +
            `Account has been successfully created.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Update account
  server.registerTool(
    "fortnox_update_account",
    {
      title: "Update Fortnox Account",
      description: `Update an existing account in the chart of accounts.

Args:
  - account_number (number): Account number to update (required)
  - description (string): Account description
  - vat_code (string): VAT code
  - active (boolean): Whether the account is active
  - cost_center_settings ('ALLOWED' | 'MANDATORY' | 'NOTALLOWED'): Cost center settings
  - project_settings ('ALLOWED' | 'MANDATORY' | 'NOTALLOWED'): Project settings
  - response_format ('markdown' | 'json'): Output format

Returns:
  The updated account details.`,
      inputSchema: UpdateAccountSchema,
      outputSchema: MutateAccountOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UpdateAccountInput) => {
      try {
        const accountData: Record<string, unknown> = {};

        if (params.description) accountData.Description = params.description;
        if (params.vat_code) accountData.VATCode = params.vat_code;
        if (params.active !== undefined) accountData.Active = params.active;
        if (params.cost_center_settings) accountData.CostCenterSettings = params.cost_center_settings;
        if (params.project_settings) accountData.ProjectSettings = params.project_settings;

        const response = await fortnoxRequest<AccountResponse>(
          `/3/accounts/${params.account_number}`,
          "PUT",
          { Account: accountData }
        );
        const account = response.Account;

        const output: MutateAccountOutput = {
          success: true,
          message: `Account ${account.Number} updated successfully`,
          account_number: account.Number,
          description: account.Description
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Account Updated\n\n` +
            `**Account Number**: ${account.Number}\n` +
            `**Description**: ${account.Description}\n\n` +
            `Account has been successfully updated.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Delete account
  server.registerTool(
    "fortnox_delete_account",
    {
      title: "Delete Fortnox Account",
      description: `Delete an account from the chart of accounts.

WARNING: This action cannot be undone. The account must not have any transactions.

Args:
  - account_number (number): Account number to delete (required)

Returns:
  Confirmation of deletion.`,
      inputSchema: DeleteAccountSchema,
      outputSchema: DeleteAccountOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: DeleteAccountInput) => {
      try {
        await fortnoxRequest(
          `/3/accounts/${params.account_number}`,
          "DELETE"
        );

        const output: DeleteAccountOutput = {
          success: true,
          message: `Account ${params.account_number} deleted successfully`
        };

        return buildToolResponse(
          `# Account Deleted\n\nAccount **${params.account_number}** has been successfully deleted.`,
          output
        );
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
