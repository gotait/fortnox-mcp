import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fortnoxRequest, fetchAllPages } from "../services/api.js";
import { ResponseFormat } from "../constants.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatListMarkdown,
  formatDetailMarkdown,
  buildPaginationMeta,
  sanitizeInline
} from "../services/formatters.js";
import {
  ListSuppliersSchema,
  GetSupplierSchema,
  CreateSupplierSchema,
  UpdateSupplierSchema,
  DeactivateSupplierSchema,
  type ListSuppliersInput,
  type GetSupplierInput,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type DeactivateSupplierInput
} from "../schemas/suppliers.js";

// API response types
interface FortnoxSupplier {
  SupplierNumber: string;
  Name: string;
  Email?: string;
  Phone1?: string;
  Address1?: string;
  Address2?: string;
  ZipCode?: string;
  City?: string;
  Country?: string;
  OrganisationNumber?: string;
  VATNumber?: string;
  Currency?: string;
  Active?: boolean;
  BankAccountNumber?: string;
  BG?: string;
  PG?: string;
  TermsOfPayment?: string;
  Comments?: string;
  "@url"?: string;
}

interface FortnoxSupplierListItem {
  SupplierNumber: string;
  Name: string;
  Email?: string;
  City?: string;
  OrganisationNumber?: string;
  Active?: boolean;
  "@url"?: string;
}

interface SupplierListResponse {
  Suppliers: FortnoxSupplierListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface SupplierResponse {
  Supplier: FortnoxSupplier;
}

/**
 * Register all supplier-related tools
 */
export function registerSupplierTools(server: McpServer): void {
  // List suppliers
  server.registerTool(
    "fortnox_list_suppliers",
    {
      title: "List Fortnox Suppliers",
      description: `List suppliers from Fortnox accounting system.

Retrieves a paginated list of suppliers with optional filtering.

Note: The Fortnox API does not support filtering suppliers server-side, so
filter and search_name are applied client-side. When either is provided, all
suppliers are fetched (subject to safety limits) and filtered before paginating.

Args:
  - limit (number): Max results per page, 1-100 (default: 20)
  - page (number): Page number for pagination (default: 1)
  - filter ('active' | 'inactive'): Filter by supplier status (client-side)
  - search_name (string): Search suppliers by name, case-insensitive partial match (client-side)
  - response_format ('markdown' | 'json'): Output format

Returns:
  List of suppliers with supplier number, name, email, city, and organisation number.`,
      inputSchema: ListSuppliersSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListSuppliersInput) => {
      try {
        let suppliers: FortnoxSupplierListItem[];
        let total: number;
        let truncated = false;
        let truncationReason: string | undefined;

        if (params.filter || params.search_name) {
          // The Fortnox API does not support these filters server-side, so
          // fetch all suppliers and filter client-side before paginating.
          const result = await fetchAllPages<FortnoxSupplierListItem, SupplierListResponse>(
            "/3/suppliers",
            {},
            (r) => r.Suppliers || [],
            (r) => r.MetaInformation?.["@TotalResources"] || 0
          );
          truncated = result.truncated;
          truncationReason = result.truncationReason;

          let filtered = result.items;
          if (params.filter) {
            const wantActive = params.filter === "active";
            filtered = filtered.filter((s) => (s.Active ?? true) === wantActive);
          }
          if (params.search_name) {
            const needle = params.search_name.toLowerCase();
            filtered = filtered.filter((s) => s.Name.toLowerCase().includes(needle));
          }

          total = filtered.length;
          const startIndex = (params.page - 1) * params.limit;
          suppliers = filtered.slice(startIndex, startIndex + params.limit);
        } else {
          const response = await fortnoxRequest<SupplierListResponse>("/3/suppliers", "GET", undefined, {
            limit: params.limit,
            page: params.page
          });
          suppliers = response.Suppliers || [];
          total = response.MetaInformation?.["@TotalResources"] || suppliers.length;
        }

        const output = {
          ...buildPaginationMeta(total, params.page, params.limit, suppliers.length),
          ...(truncated ? { truncated, truncation_reason: truncationReason } : {}),
          suppliers: suppliers.map((s) => ({
            supplier_number: s.SupplierNumber,
            name: s.Name,
            email: s.Email || null,
            city: s.City || null,
            organisation_number: s.OrganisationNumber || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatListMarkdown(
            "Suppliers",
            suppliers,
            total,
            params.page,
            params.limit,
            (s) => `## ${sanitizeInline(s.Name)} (${s.SupplierNumber})\n` +
              (s.Email ? `- **Email**: ${sanitizeInline(s.Email)}\n` : "") +
              (s.City ? `- **City**: ${sanitizeInline(s.City)}\n` : "") +
              (s.OrganisationNumber ? `- **Org.nr**: ${sanitizeInline(s.OrganisationNumber)}` : "")
          );
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get single supplier
  server.registerTool(
    "fortnox_get_supplier",
    {
      title: "Get Fortnox Supplier",
      description: `Retrieve detailed information about a specific supplier.

Args:
  - supplier_number (string): The supplier number to retrieve (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Complete supplier details including contact info, addresses, bank details, and payment terms.`,
      inputSchema: GetSupplierSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetSupplierInput) => {
      try {
        const response = await fortnoxRequest<SupplierResponse>(
          `/3/suppliers/${encodeURIComponent(params.supplier_number)}`
        );
        const supplier = response.Supplier;

        const output = {
          supplier_number: supplier.SupplierNumber,
          name: supplier.Name,
          email: supplier.Email || null,
          phone: supplier.Phone1 || null,
          address1: supplier.Address1 || null,
          address2: supplier.Address2 || null,
          zip_code: supplier.ZipCode || null,
          city: supplier.City || null,
          country: supplier.Country || null,
          organisation_number: supplier.OrganisationNumber || null,
          vat_number: supplier.VATNumber || null,
          currency: supplier.Currency || null,
          active: supplier.Active ?? true,
          bank_account: supplier.BankAccountNumber || null,
          bg_number: supplier.BG || null,
          pg_number: supplier.PG || null,
          terms_of_payment: supplier.TermsOfPayment || null,
          comments: supplier.Comments || null
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatDetailMarkdown(`Supplier: ${sanitizeInline(supplier.Name)}`, [
            { label: "Supplier Number", value: supplier.SupplierNumber },
            { label: "Name", value: sanitizeInline(supplier.Name) },
            { label: "Email", value: sanitizeInline(supplier.Email) },
            { label: "Phone", value: sanitizeInline(supplier.Phone1) },
            { label: "Address", value: sanitizeInline([supplier.Address1, supplier.Address2].filter(Boolean).join(", ")) },
            { label: "ZIP/City", value: sanitizeInline([supplier.ZipCode, supplier.City].filter(Boolean).join(" ")) },
            { label: "Country", value: sanitizeInline(supplier.Country) },
            { label: "Organisation Number", value: sanitizeInline(supplier.OrganisationNumber) },
            { label: "VAT Number", value: sanitizeInline(supplier.VATNumber) },
            { label: "Currency", value: sanitizeInline(supplier.Currency) },
            { label: "Active", value: supplier.Active },
            { label: "Bank Account", value: sanitizeInline(supplier.BankAccountNumber) },
            { label: "Bankgiro", value: sanitizeInline(supplier.BG) },
            { label: "Plusgiro", value: sanitizeInline(supplier.PG) },
            { label: "Payment Terms", value: sanitizeInline(supplier.TermsOfPayment) },
            { label: "Comments", value: sanitizeInline(supplier.Comments) }
          ]);
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Create supplier
  server.registerTool(
    "fortnox_create_supplier",
    {
      title: "Create Fortnox Supplier",
      description: `Create a new supplier in Fortnox.

Args:
  - name (string): Supplier name (required)
  - supplier_number (string): Supplier number (auto-generated if not provided)
  - organisation_number (string): Company registration number
  - email (string): Email address
  - phone (string): Phone number
  - address1, address2, zip_code, city, country, country_code: Address fields
  - currency (string): 3-letter currency code
  - vat_number (string): VAT registration number
  - bank_account (string): Bank account number
  - bg_number (string): Bankgiro number
  - pg_number (string): Plusgiro number
  - terms_of_payment (string): Payment terms code
  - comments (string): Internal comments
  - response_format ('markdown' | 'json'): Output format

Returns:
  The created supplier with assigned supplier number.`,
      inputSchema: CreateSupplierSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateSupplierInput) => {
      try {
        const supplierData: Record<string, unknown> = {
          Name: params.name
        };

        if (params.supplier_number) supplierData.SupplierNumber = params.supplier_number;
        if (params.organisation_number) supplierData.OrganisationNumber = params.organisation_number;
        if (params.email) supplierData.Email = params.email;
        if (params.phone) supplierData.Phone1 = params.phone;
        if (params.address1) supplierData.Address1 = params.address1;
        if (params.address2) supplierData.Address2 = params.address2;
        if (params.zip_code) supplierData.ZipCode = params.zip_code;
        if (params.city) supplierData.City = params.city;
        if (params.country) supplierData.Country = params.country;
        if (params.country_code) supplierData.CountryCode = params.country_code;
        if (params.currency) supplierData.Currency = params.currency;
        if (params.vat_number) supplierData.VATNumber = params.vat_number;
        if (params.bank_account) supplierData.BankAccountNumber = params.bank_account;
        if (params.bg_number) supplierData.BG = params.bg_number;
        if (params.pg_number) supplierData.PG = params.pg_number;
        if (params.terms_of_payment) supplierData.TermsOfPayment = params.terms_of_payment;
        if (params.comments) supplierData.Comments = params.comments;

        const response = await fortnoxRequest<SupplierResponse>(
          "/3/suppliers",
          "POST",
          { Supplier: supplierData }
        );
        const supplier = response.Supplier;

        const output = {
          success: true,
          message: `Supplier "${supplier.Name}" created successfully`,
          supplier_number: supplier.SupplierNumber,
          name: supplier.Name
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Supplier Created\n\n` +
            `**Supplier Number**: ${supplier.SupplierNumber}\n` +
            `**Name**: ${supplier.Name}\n\n` +
            `Supplier has been successfully created in Fortnox.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Update supplier
  server.registerTool(
    "fortnox_update_supplier",
    {
      title: "Update Fortnox Supplier",
      description: `Update an existing supplier in Fortnox.

Args:
  - supplier_number (string): Supplier number to update (required)
  - active (boolean): Whether the supplier is active (set true to reactivate)
  - All other fields from create_supplier (only provided fields are updated)
  - response_format ('markdown' | 'json'): Output format

Returns:
  The updated supplier details.`,
      inputSchema: UpdateSupplierSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UpdateSupplierInput) => {
      try {
        const supplierData: Record<string, unknown> = {};

        if (params.name) supplierData.Name = params.name;
        if (params.organisation_number) supplierData.OrganisationNumber = params.organisation_number;
        if (params.email) supplierData.Email = params.email;
        if (params.phone) supplierData.Phone1 = params.phone;
        if (params.address1) supplierData.Address1 = params.address1;
        if (params.address2) supplierData.Address2 = params.address2;
        if (params.zip_code) supplierData.ZipCode = params.zip_code;
        if (params.city) supplierData.City = params.city;
        if (params.country) supplierData.Country = params.country;
        if (params.country_code) supplierData.CountryCode = params.country_code;
        if (params.currency) supplierData.Currency = params.currency;
        if (params.vat_number) supplierData.VATNumber = params.vat_number;
        if (params.active !== undefined) supplierData.Active = params.active;
        if (params.bank_account) supplierData.BankAccountNumber = params.bank_account;
        if (params.bg_number) supplierData.BG = params.bg_number;
        if (params.pg_number) supplierData.PG = params.pg_number;
        if (params.terms_of_payment) supplierData.TermsOfPayment = params.terms_of_payment;
        if (params.comments) supplierData.Comments = params.comments;

        const response = await fortnoxRequest<SupplierResponse>(
          `/3/suppliers/${encodeURIComponent(params.supplier_number)}`,
          "PUT",
          { Supplier: supplierData }
        );
        const supplier = response.Supplier;

        const output = {
          success: true,
          message: `Supplier "${supplier.Name}" updated successfully`,
          supplier_number: supplier.SupplierNumber,
          name: supplier.Name
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Supplier Updated\n\n` +
            `**Supplier Number**: ${supplier.SupplierNumber}\n` +
            `**Name**: ${supplier.Name}\n\n` +
            `Supplier has been successfully updated.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Deactivate supplier
  server.registerTool(
    "fortnox_deactivate_supplier",
    {
      title: "Deactivate Fortnox Supplier",
      description: `Deactivate a supplier in Fortnox.

Suppliers cannot be deleted via the Fortnox API. This tool sets the supplier's
Active flag to false instead, hiding it from active supplier lists. To
reactivate, use fortnox_update_supplier with active=true.

Args:
  - supplier_number (string): Supplier number to deactivate (required)

Returns:
  Confirmation of deactivation.`,
      inputSchema: DeactivateSupplierSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: DeactivateSupplierInput) => {
      try {
        await fortnoxRequest<SupplierResponse>(
          `/3/suppliers/${encodeURIComponent(params.supplier_number)}`,
          "PUT",
          { Supplier: { Active: false } }
        );

        const output = {
          success: true,
          message: `Supplier ${params.supplier_number} deactivated successfully`
        };

        return buildToolResponse(
          `# Supplier Deactivated\n\nSupplier **${params.supplier_number}** has been set to inactive. ` +
            `Suppliers cannot be deleted via the Fortnox API. ` +
            `Use fortnox_update_supplier with active=true to reactivate.`,
          output
        );
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
