import Link from "next/link";

type FeatureCard = {
  title: string;
  description: string;
  href: string;
  cta: string;
};

const featureCards: FeatureCard[] = [
  {
    title: "Testing",
    description:
      "Run text extraction and data classification using the same SICO API/worker pipeline used by the rest of the platform.",
    href: "/testing/test-text-extraction",
    cta: "Open testing tools"
  },
  {
    title: "Purview Recipes",
    description:
      "Browse SIT and DLP recipe libraries with normalized metadata, technical detail, provenance, and source references.",
    href: "/purview-recipes/sit-library",
    cta: "Open recipe library"
  },
  {
    title: "Build",
    description:
      "Use SIT Builder and DLP Builder scaffolds to progress toward deterministic rule-pack generation and deployment automation.",
    href: "/build/sit-builder",
    cta: "Open build area"
  }
];

const quickLinks = [
  { label: "Text Extraction", href: "/testing/test-text-extraction" },
  { label: "Test Data Classification", href: "/testing/test-data-classification" },
  { label: "SIT Library", href: "/purview-recipes/sit-library" },
  { label: "DLP Library", href: "/purview-recipes/dlp-library" },
  { label: "SIT Builder", href: "/build/sit-builder" },
  { label: "DLP Builder", href: "/build/dlp-builder" }
];

function PlatformFlowDiagram() {
  return (
    <svg
      className="h-auto w-full rounded-xl border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-dark-2"
      viewBox="0 0 1040 230"
      role="img"
      aria-label="SICO platform flow"
    >
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#5750F1" />
        </marker>
      </defs>
      <rect x="20" y="60" width="170" height="96" rx="12" fill="#EEF2FF" stroke="#5750F1" />
      <text x="105" y="96" textAnchor="middle" fontSize="16" fill="#1A2231" fontWeight="600">
        Ingest
      </text>
      <text x="105" y="120" textAnchor="middle" fontSize="12" fill="#364153">
        file upload
      </text>

      <rect x="230" y="60" width="190" height="96" rx="12" fill="#ECFDF3" stroke="#12B76A" />
      <text x="325" y="96" textAnchor="middle" fontSize="16" fill="#1A2231" fontWeight="600">
        Text Extraction
      </text>
      <text x="325" y="120" textAnchor="middle" fontSize="12" fill="#364153">
        test-textextraction
      </text>

      <rect x="460" y="60" width="190" height="96" rx="12" fill="#FEF3F2" stroke="#F04438" />
      <text x="555" y="96" textAnchor="middle" fontSize="16" fill="#1A2231" fontWeight="600">
        Normalize
      </text>
      <text x="555" y="120" textAnchor="middle" fontSize="12" fill="#364153">
        staged text cleanup
      </text>

      <rect x="690" y="60" width="170" height="96" rx="12" fill="#F4F3FF" stroke="#7A5AF8" />
      <text x="775" y="96" textAnchor="middle" fontSize="16" fill="#1A2231" fontWeight="600">
        Classify
      </text>
      <text x="775" y="120" textAnchor="middle" fontSize="12" fill="#364153">
        test-dataclassication
      </text>

      <rect x="900" y="60" width="120" height="96" rx="12" fill="#FDF2FA" stroke="#EE46BC" />
      <text x="960" y="96" textAnchor="middle" fontSize="16" fill="#1A2231" fontWeight="600">
        Outcome
      </text>
      <text x="960" y="120" textAnchor="middle" fontSize="12" fill="#364153">
        evidence
      </text>

      <line x1="190" y1="108" x2="230" y2="108" stroke="#5750F1" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <line x1="420" y1="108" x2="460" y2="108" stroke="#5750F1" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <line x1="650" y1="108" x2="690" y2="108" stroke="#5750F1" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <line x1="860" y1="108" x2="900" y2="108" stroke="#5750F1" strokeWidth="2.5" markerEnd="url(#arrow)" />
    </svg>
  );
}

function CapabilityDiagram() {
  return (
    <svg
      className="h-auto w-full rounded-xl border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-dark-2"
      viewBox="0 0 1040 260"
      role="img"
      aria-label="SICO capability map"
    >
      <rect x="20" y="25" width="1000" height="210" rx="14" fill="#0F172A" />
      <text x="520" y="55" textAnchor="middle" fontSize="20" fill="#F8FAFC" fontWeight="700">
        SICO Capability Map
      </text>

      <rect x="65" y="80" width="280" height="130" rx="12" fill="#1E293B" stroke="#60A5FA" />
      <text x="205" y="112" textAnchor="middle" fontSize="16" fill="#E2E8F0" fontWeight="600">
        Testing Workbench
      </text>
      <text x="205" y="138" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        Text extraction
      </text>
      <text x="205" y="156" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        Data classification
      </text>
      <text x="205" y="174" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        Container file visibility
      </text>

      <rect x="380" y="80" width="280" height="130" rx="12" fill="#1E293B" stroke="#34D399" />
      <text x="520" y="112" textAnchor="middle" fontSize="16" fill="#E2E8F0" fontWeight="600">
        Purview Recipes
      </text>
      <text x="520" y="138" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        SIT Library
      </text>
      <text x="520" y="156" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        DLP Library
      </text>
      <text x="520" y="174" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        Provenance and references
      </text>

      <rect x="695" y="80" width="280" height="130" rx="12" fill="#1E293B" stroke="#F59E0B" />
      <text x="835" y="112" textAnchor="middle" fontSize="16" fill="#E2E8F0" fontWeight="600">
        Build
      </text>
      <text x="835" y="138" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        SIT Builder scaffold
      </text>
      <text x="835" y="156" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        DLP Builder scaffold
      </text>
      <text x="835" y="174" textAnchor="middle" fontSize="12" fill="#CBD5E1">
        DB-ready extension path
      </text>
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">SICO Platform</p>
        <h1 className="mt-2 text-3xl font-bold text-dark dark:text-white">Classification and DLP Engineering Workbench</h1>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-dark-5 dark:text-dark-6">
          SICO is an engineering-focused environment for testing extraction pipelines, validating SIT detection behavior,
          and preparing deterministic Purview-aligned recipe content for policy automation.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-stroke px-3 py-1.5 text-xs font-medium text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {featureCards.map((card) => (
          <article
            key={card.title}
            className="rounded-2xl border border-stroke bg-white p-5 shadow-sm dark:border-dark-3 dark:bg-dark-2"
          >
            <h2 className="text-lg font-semibold text-dark dark:text-white">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-dark-5 dark:text-dark-6">{card.description}</p>
            <Link
              href={card.href}
              className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
            >
              {card.cta}
            </Link>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <h2 className="text-xl font-semibold text-dark dark:text-white">Processing Flow</h2>
        <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
          End-to-end deterministic pipeline from input through extraction, normalization, classification, and evidence output.
        </p>
        <div className="mt-4">
          <PlatformFlowDiagram />
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <h2 className="text-xl font-semibold text-dark dark:text-white">Capability Coverage</h2>
        <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
          Current areas are organized for testing, recipe authoring, and future build/deployment workflows.
        </p>
        <div className="mt-4">
          <CapabilityDiagram />
        </div>
      </section>
    </div>
  );
}
