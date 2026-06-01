const normalizeOrgText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ORG_CANONICAL_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "BONELA",
    aliases: ["bonela"],
  },
  {
    canonical: "MBGE",
    aliases: [
      "mbge",
      "men boys",
      "men and boys",
      "men boys for gender equality",
      "men and boys for gender equality",
      "men boys for gender equality mbge",
      "men and boys for gender equality mbge",
    ],
  },
  {
    canonical: "Gende Fountain",
    aliases: [
      "gfc",
      "gender fountain",
      "gender fountain center",
      "gende fountain",
    ],
  },
  {
    canonical: "Ovajuha",
    aliases: ["ovajua", "ovajhuha", "ovajuha"],
  },
  {
    canonical: "Inpired Horizons",
    aliases: ["inspired horizons", "inspired hozirons", "inpired horizons"],
  },
  {
    canonical: "TEBELOPELE",
    aliases: ["tebelopele", "tebe lopele"],
  },
  {
    canonical: "BONEPWA",
    aliases: ["bonepwa", "bone pwa"],
  },
  {
    canonical: "MAKGABANENG",
    aliases: ["makgabaneng", "mak gabaneng"],
  },
  {
    canonical: "AHEEME",
    aliases: ["aheeme", "a he eme"],
  },
];

const ORG_ALIAS_LOOKUP = new Map<string, string>(
  ORG_CANONICAL_ALIASES.flatMap(({ canonical, aliases }) =>
    aliases.map((alias) => [normalizeOrgText(alias), canonical] as const),
  ),
);

export const RECOGNIZED_PARENT_ORGANIZATIONS = [
  "BONELA",
  "MBGE",
  "TEBELOPELE",
  "BONEPWA",
  "MAKGABANENG",
] as const;

const RECOGNIZED_PARENT_SET = new Set<string>(RECOGNIZED_PARENT_ORGANIZATIONS);

export const canonicalizeOrganizationName = (name: string) => {
  const normalized = normalizeOrgText(name);
  const canonical = ORG_ALIAS_LOOKUP.get(normalized);
  if (canonical) return canonical;
  return name.trim();
};

export const isRecognizedParentOrganizationName = (name: string) =>
  RECOGNIZED_PARENT_SET.has(canonicalizeOrganizationName(name));
