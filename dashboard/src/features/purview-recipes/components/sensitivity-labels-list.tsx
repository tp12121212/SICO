import type { JsonObject, JsonValue } from "../types/sit";

type SensitivityLabelsListProps = {
  labels: JsonObject | undefined;
};

type LabelReference = {
  code: string;
  framework: string;
  url: string;
};

const LABEL_REFERENCE_MAP: Record<string, LabelReference> = {
  qgiscf: {
    code: "qgiscf",
    framework: "Queensland Government Information Security Classification Framework (QGISCF)",
    url: "https://www.forgov.qld.gov.au/information-technology/queensland-government-enterprise-architecture-qgea/qgea-directions-and-guidance/qgea-policies-standards-and-guidelines/information-security-classification-framework-qgiscf"
  },
  qgiscf_dlm: {
    code: "qgiscf_dlm",
    framework: "QGISCF Dissemination Limiting Markers (DLM) guidance",
    url: "https://www.forgov.qld.gov.au/information-technology/queensland-government-enterprise-architecture-qgea/qgea-directions-and-guidance/qgea-policies-standards-and-guidelines/information-security-classification-framework-qgiscf"
  },
  giscf: {
    code: "giscf",
    framework: "Queensland Government Information Security Classification Framework (QGISCF)",
    url: "https://www.forgov.qld.gov.au/information-technology/queensland-government-enterprise-architecture-qgea/qgea-directions-and-guidance/qgea-policies-standards-and-guidelines/information-security-classification-framework-qgiscf"
  },
  giscf_dlm: {
    code: "giscf_dlm",
    framework: "QGISCF Dissemination Limiting Markers (DLM) guidance",
    url: "https://www.forgov.qld.gov.au/information-technology/queensland-government-enterprise-architecture-qgea/qgea-directions-and-guidance/qgea-policies-standards-and-guidelines/information-security-classification-framework-qgiscf"
  },
  uk_gov: {
    code: "uk_gov",
    framework: "UK Government Security Classifications Policy",
    url: "https://www.gov.uk/government/publications/government-security-classifications/government-security-classifications-policy-html"
  },
  pspf: {
    code: "pspf",
    framework: "Australian Government PSPF / Email Protective Marking Standard",
    url: "https://www.protectivesecurity.gov.au/publications-library/australian-government-email-protective-marking-standard-2025"
  },
  nz_gov: {
    code: "nz_gov",
    framework: "New Zealand Protective Security Requirements - Classification",
    url: "https://www.protectivesecurity.govt.nz/classification/overview"
  },
  ca_gov: {
    code: "ca_gov",
    framework: "Government of Canada Security Classification guidance",
    url: "https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32611"
  },
  us_gov: {
    code: "us_gov",
    framework: "US Government CUI Program (NARA)",
    url: "https://www.archives.gov/cui"
  }
};

function normalizeScalar(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function titleFromCode(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function SensitivityLabelsList({ labels }: SensitivityLabelsListProps) {
  if (!labels || Object.keys(labels).length === 0) {
    return <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No sensitivity labels provided.</p>;
  }

  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mt-3 space-y-3">
      {entries.map(([code, value]) => {
        const normalizedCode = code.trim();
        const reference = LABEL_REFERENCE_MAP[normalizedCode];
        const labelValue = normalizeScalar(value);

        return (
          <article
            key={normalizedCode}
            className="rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{labelValue || "Not specified"}</p>
              <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">
                {normalizedCode}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">
              {reference ? reference.framework : titleFromCode(normalizedCode)}
            </p>
            {reference ? (
              <a
                href={reference.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
              >
                {reference.url}
              </a>
            ) : (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">No mapped policy URL yet.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
