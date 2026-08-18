/**
 * Browser-facing pages for the authorization flow.
 *
 * Everything here is rendered to a human in a browser mid-OAuth: the access
 * level question, and the failure screens. Kept out of fortnoxAuthHandler.ts so
 * that module stays about the flow rather than about markup.
 *
 * Self-contained by necessity — a Worker has no asset pipeline, and a consent
 * or error screen is the worst place to depend on an external stylesheet.
 */

/** Path the access-level form posts back to. */
export const MODE_PATH = "/authorize/mode";

/**
 * Clients register their own name through dynamic client registration, so a
 * client name is attacker-controlled text going into a page. Escape it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = `
  :root { color-scheme: light dark; --fg: #1c1917; --bg: #fafaf9; --muted: #57534e;
          --line: #d6d3d1; --card: #ffffff; --warn: #9a3412; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #f5f5f4; --bg: #1c1917; --muted: #a8a29e; --line: #44403c;
            --card: #292524; --warn: #fdba74; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--fg);
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; }
  h1 { margin: 0 0 .5rem; font-size: 1.5rem; line-height: 1.25; }
  .lede { margin: 0 0 2rem; color: var(--muted); }
  fieldset { border: 0; margin: 0; padding: 0; }
  legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .card { border: 1px solid var(--line); border-radius: .5rem; background: var(--card);
          padding: 1.1rem 1.25rem; margin-bottom: .75rem; }
  .card h2 { margin: 0 0 .35rem; font-size: 1rem; }
  .card p { margin: 0; font-size: .9rem; color: var(--muted); }
  .tag { display: inline-block; margin-left: .5rem; font-size: .7rem; letter-spacing: .04em;
         text-transform: uppercase; color: var(--muted); border: 1px solid var(--line);
         border-radius: .25rem; padding: 0 .35rem; vertical-align: .1em; }
  button { width: 100%; margin-top: .9rem; padding: .7rem 1rem; font: inherit; font-weight: 600;
           color: var(--bg); background: var(--fg); border: 1px solid var(--fg);
           border-radius: .375rem; cursor: pointer; }
  .card.secondary button { color: var(--fg); background: transparent; }
  .note { margin-top: 2rem; font-size: .85rem; color: var(--muted); }
  ol { margin: .25rem 0 0; padding-left: 1.35rem; font-size: .9rem; color: var(--muted); }
  ol li { margin: .35rem 0; }
  .kicker { margin: 0 0 .4rem; font-size: .75rem; letter-spacing: .06em; text-transform: uppercase;
            color: var(--warn); }
  details { margin-top: 1.5rem; font-size: .85rem; color: var(--muted); }
  summary { cursor: pointer; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85em;
         background: var(--card); border: 1px solid var(--line); border-radius: .25rem; padding: 0 .3em; }
  pre { overflow-x: auto; background: var(--card); border: 1px solid var(--line);
        border-radius: .375rem; padding: .75rem; margin: .6rem 0 0; }
  a { color: inherit; }
`;

function shell(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      // These pages carry a single-use nonce and post it back. Nothing should
      // frame them, and nothing off-origin should load.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * The access-level question, shown before the user leaves for Fortnox.
 *
 * Read-only comes first and is the default answer a hurried user gives.
 */
export function accessLevelPage(state: string, clientName?: string): Response {
  const who = clientName
    ? `<strong>${escapeHtml(clientName)}</strong> vill ansluta till ditt Fortnox-företag.`
    : "En app vill ansluta till ditt Fortnox-företag.";

  return shell(
    "Välj åtkomstnivå",
    `  <h1>Välj åtkomstnivå</h1>
  <p class="lede">${who} Nästa steg är inloggning hos Fortnox.</p>

  <form method="post" action="${MODE_PATH}">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <fieldset>
      <legend>Åtkomstnivå</legend>

      <div class="card">
        <h2>Endast läsning<span class="tag">Rekommenderas</span></h2>
        <p>Appen kan läsa uppgifter i ditt Fortnox-företag — fakturor, kunder, leverantörer,
           verifikationer, konton och rapporter. Ingenting kan skapas, ändras eller raderas.</p>
        <button type="submit" name="mode" value="readonly">Ge läsåtkomst</button>
      </div>

      <div class="card secondary">
        <h2>Läsa och skriva</h2>
        <p>Appen kan dessutom skapa, ändra och radera uppgifter i ditt Fortnox-företag, till
           exempel fakturor, kunder och verifikationer. Välj detta bara om du behöver det.</p>
        <button type="submit" name="mode" value="full">Ge läs- och skrivåtkomst</button>
      </div>
    </fieldset>
  </form>

  <p class="note">Valet gäller den här anslutningen. Du kan ändra det genom att ansluta igen,
     och du kan när som helst återkalla åtkomsten i ditt Fortnox-program.</p>`,
    200
  );
}

/** What an error page says. `steps` is what the reader can actually do next. */
export interface ErrorGuidance {
  title: string;
  explanation: string;
  steps?: string[];
  /** Shown under the steps — usually who to contact or what the operator must do. */
  footnote?: string;
  status: number;
}

/**
 * Render a failure with whatever we know about its cause.
 *
 * `technical` is folded away behind a disclosure: it is what makes a support
 * mail useful, and noise for everyone else.
 */
export function errorPage(
  guidance: ErrorGuidance,
  technical?: string,
  supportEmail?: string
): Response {
  const steps = guidance.steps?.length
    ? `<ol>${guidance.steps.map((s) => `<li>${s}</li>`).join("")}</ol>`
    : "";

  const footnote = guidance.footnote ? `<p class="note">${guidance.footnote}</p>` : "";

  const support = supportEmail
    ? `<p class="note">Behöver du hjälp? Mejla <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(
        supportEmail
      )}</a>${technical ? " och klistra in de tekniska detaljerna nedan." : "."}</p>`
    : "";

  const details = technical
    ? `<details>
    <summary>Tekniska detaljer</summary>
    <pre>${escapeHtml(technical)}</pre>
  </details>`
    : "";

  return shell(
    guidance.title,
    `  <p class="kicker">Anslutningen misslyckades</p>
  <h1>${escapeHtml(guidance.title)}</h1>
  <p class="lede">${guidance.explanation}</p>
  ${steps}
  ${footnote}
  ${support}
  ${details}`,
    guidance.status
  );
}

/**
 * Map an error Fortnox returned on the callback to something actionable.
 *
 * Matching is on the code first and the description second, because Fortnox
 * does not document a closed set of codes and the description is sometimes the
 * only thing that identifies the case.
 */
export function fortnoxCallbackGuidance(
  code: string,
  description: string
): ErrorGuidance {
  const haystack = `${code} ${description}`.toLowerCase();

  // Documented in Fortnox's developer FAQ: the integration is set to be
  // purchased *in* Fortnox but is not published, so no company can hold a
  // licence for it — including ours. It is not a billing failure.
  if (haystack.includes("missing_app_license") || haystack.includes("enough licenses")) {
    return {
      title: "Ditt Fortnox-företag saknar licens för integrationen",
      explanation:
        "Fortnox nekade anslutningen eftersom det inte finns någon aktiv licens för den här " +
        "integrationen på ditt Fortnox-företag. Det är inte en betalning som har misslyckats.",
      steps: [
        "Logga in i Fortnox och gå till <strong>Integrationer</strong>. Sök upp integrationen och köp eller aktivera den där.",
        "Licensen kan också beställas under <strong>Tilläggsbeställning</strong> eller <strong>Hantera användare</strong>.",
        "Kom tillbaka hit och anslut igen när licensen är aktiv.",
      ],
      footnote:
        "Hittar du inte integrationen i Fortnox är den ännu inte publicerad i Fortnox App-market. " +
        "Då är det vi som utvecklare som behöver publicera den, eller ställa om den till försäljning " +
        "via webbplats i Fortnox utvecklarportal — hör av dig och vi ordnar det.",
      status: 400,
    };
  }

  // Standard OAuth: the user said no, or closed the Fortnox screen.
  if (haystack.includes("access_denied")) {
    return {
      title: "Anslutningen avbröts",
      explanation:
        "Inloggningen hos Fortnox avbröts, så ingen åtkomst har getts. Ingenting har ändrats i ditt " +
        "Fortnox-företag.",
      steps: ["Starta anslutningen igen från appen om det inte var meningen."],
      status: 400,
    };
  }

  // Fortnox rejects the whole authorization when a requested scope is not one
  // the app has been granted — a configuration problem at our end, not the
  // customer's, so don't send them off to fix something they can't.
  if (haystack.includes("scope")) {
    return {
      title: "Integrationen begärde en behörighet den inte har",
      explanation:
        "Fortnox nekade anslutningen eftersom integrationen bad om en behörighet som inte är " +
        "godkänd för den. Det är ett konfigurationsfel hos oss, inte hos dig.",
      footnote:
        "Vi behöver rätta de begärda behörigheterna (FORTNOX_SCOPES) så att de matchar vad " +
        "Fortnox-appen har godkänts för. Hör av dig så fixar vi det.",
      status: 400,
    };
  }

  if (haystack.includes("invalid_client") || haystack.includes("unauthorized_client")) {
    return {
      title: "Integrationen känns inte igen av Fortnox",
      explanation:
        "Fortnox godtog inte integrationens identitet eller den adress du skickades tillbaka till. " +
        "Det är ett konfigurationsfel hos oss.",
      footnote: "Hör av dig med de tekniska detaljerna nedan så rättar vi det.",
      status: 400,
    };
  }

  if (haystack.includes("temporarily_unavailable") || haystack.includes("server_error")) {
    return {
      title: "Fortnox kunde inte svara just nu",
      explanation:
        "Fortnox svarade med ett tillfälligt fel. Ingenting har ändrats i ditt Fortnox-företag.",
      steps: ["Vänta en minut och försök ansluta igen."],
      status: 502,
    };
  }

  return {
    title: "Fortnox nekade anslutningen",
    explanation:
      "Fortnox avbröt inloggningen och vi kan inte säga säkert varför. Ingenting har ändrats i ditt " +
      "Fortnox-företag.",
    steps: ["Försök ansluta igen."],
    status: 400,
  };
}
