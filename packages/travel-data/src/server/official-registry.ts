import {
  type LaunchDestinationCode,
  type OfficialSourceCategory,
  type OfficialSourceInput,
  type OfficialSourceLink,
  type OfficialSourceValue,
  isOfficialSourceInput,
} from "../practical.js";
import {
  type ProviderAdapterResult,
  type ProviderRequestContext,
  type ProviderSource,
  type TravelDataAdapter,
  type TravelDataClass,
  providerError,
} from "../contracts.js";

const provider = "roavia-official-registry";
const sourceLicense = "Official link registry; source-specific reuse terms apply";

type RegistryRecord = OfficialSourceLink & { destination: LaunchDestinationCode };

const reviewedAt = "2026-07-29";

function record(
  destination: LaunchDestinationCode,
  category: OfficialSourceCategory,
  authority: string,
  title: string,
  url: string,
  locale = "en",
): RegistryRecord {
  return { authority, category, destination, locale, reviewedAt, title, url };
}

export const launchOfficialSourceRecords: readonly RegistryRecord[] = [
  record(
    "singapore",
    "weather_alert",
    "Meteorological Service Singapore",
    "Singapore weather warnings",
    "https://www.weather.gov.sg/warning-heavy-rain/",
  ),
  record(
    "singapore",
    "holiday",
    "Singapore Ministry of Manpower",
    "Singapore public holidays",
    "https://www.mom.gov.sg/employment-practices/public-holidays",
  ),
  record(
    "singapore",
    "event",
    "Singapore Tourism Board",
    "Singapore official events calendar",
    "https://www.visitsingapore.com/whats-happening/all-happenings/",
  ),
  record(
    "singapore",
    "visa",
    "Singapore Immigration & Checkpoints Authority",
    "Entering Singapore",
    "https://www.ica.gov.sg/enter-transit-depart/entering-singapore",
  ),
  record(
    "singapore",
    "emergency",
    "Singapore Police Force",
    "Singapore emergency contacts",
    "https://www.police.gov.sg/contact-us",
  ),
  record(
    "singapore",
    "closure",
    "Singapore Land Transport Authority",
    "Singapore traffic and road notices",
    "https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/traffic_information.html",
  ),

  record(
    "tokyo",
    "weather_alert",
    "Japan Meteorological Agency",
    "Japan weather warnings",
    "https://www.jma.go.jp/bosai/warning/",
  ),
  record(
    "tokyo",
    "holiday",
    "Cabinet Office, Government of Japan",
    "Japan national holidays",
    "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
  ),
  record(
    "tokyo",
    "event",
    "Tokyo Convention & Visitors Bureau",
    "Tokyo official events guide",
    "https://www.gotokyo.org/en/see-and-do/",
  ),
  record(
    "tokyo",
    "visa",
    "Ministry of Foreign Affairs of Japan",
    "Visa information for Japan",
    "https://www.mofa.go.jp/j_info/visit/visa/index.html",
  ),
  record(
    "tokyo",
    "emergency",
    "Japan National Tourism Organization",
    "Japan emergency information",
    "https://www.japan.travel/en/plan/emergencies/",
  ),
  record(
    "tokyo",
    "closure",
    "Tokyo Metropolitan Bureau of Transportation",
    "Tokyo transport operating information",
    "https://www.kotsu.metro.tokyo.jp/eng/",
  ),

  record(
    "paris",
    "weather_alert",
    "Météo-France",
    "France weather vigilance",
    "https://vigilance.meteofrance.fr/fr",
    "fr",
  ),
  record(
    "paris",
    "holiday",
    "Service-Public.fr",
    "France public holidays",
    "https://www.service-public.fr/particuliers/vosdroits/F2405",
    "fr",
  ),
  record(
    "paris",
    "event",
    "City of Paris",
    "Paris official events calendar",
    "https://quefaire.paris.fr/",
    "fr",
  ),
  record(
    "paris",
    "visa",
    "Government of France",
    "France visa information",
    "https://france-visas.gouv.fr/en/",
  ),
  record(
    "paris",
    "emergency",
    "Service-Public.fr",
    "France emergency numbers",
    "https://www.service-public.fr/particuliers/vosdroits/F33954",
    "fr",
  ),
  record(
    "paris",
    "closure",
    "City of Paris",
    "Paris park and garden closures",
    "https://www.paris.fr/lieux/parcs-jardins-et-bois/tous-les-horaires",
    "fr",
  ),

  record(
    "new-york-city",
    "weather_alert",
    "US National Weather Service",
    "New York City weather alerts",
    "https://www.weather.gov/okx/",
  ),
  record(
    "new-york-city",
    "holiday",
    "US Office of Personnel Management",
    "United States federal holidays",
    "https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/",
  ),
  record(
    "new-york-city",
    "event",
    "City of New York",
    "New York City official events",
    "https://www.nyc.gov/events/",
  ),
  record(
    "new-york-city",
    "visa",
    "US Department of State",
    "United States visa information",
    "https://travel.state.gov/content/travel/en/us-visas.html",
  ),
  record(
    "new-york-city",
    "emergency",
    "NYC Emergency Management",
    "New York City emergency resources",
    "https://www.nyc.gov/site/em/resources/contact-us.page",
  ),
  record(
    "new-york-city",
    "closure",
    "City of New York",
    "New York City severe weather and closures",
    "https://www.nyc.gov/site/severeweather/index.page",
  ),

  record(
    "sydney",
    "weather_alert",
    "Australian Bureau of Meteorology",
    "New South Wales weather warnings",
    "https://www.bom.gov.au/nsw/warnings/",
  ),
  record(
    "sydney",
    "holiday",
    "Fair Work Ombudsman",
    "Australia public holidays",
    "https://www.fairwork.gov.au/employment-conditions/public-holidays",
  ),
  record(
    "sydney",
    "event",
    "City of Sydney",
    "Sydney official events calendar",
    "https://whatson.cityofsydney.nsw.gov.au/",
  ),
  record(
    "sydney",
    "visa",
    "Australian Department of Home Affairs",
    "Australia visa finder",
    "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-finder",
  ),
  record(
    "sydney",
    "emergency",
    "NSW Government",
    "New South Wales emergency information",
    "https://www.nsw.gov.au/emergency",
  ),
  record(
    "sydney",
    "closure",
    "Transport for NSW",
    "New South Wales live traffic and closures",
    "https://www.livetraffic.com/",
  ),

  record(
    "reykjavik",
    "weather_alert",
    "Icelandic Meteorological Office",
    "Iceland weather alerts",
    "https://en.vedur.is/alerts",
  ),
  record(
    "reykjavik",
    "holiday",
    "Central Bank of Iceland",
    "Iceland public holiday opening information",
    "https://cb.is/about-the-bank/public-holidays-in-iceland/",
  ),
  record(
    "reykjavik",
    "event",
    "City of Reykjavík",
    "Reykjavík official events",
    "https://reykjavik.is/en/events",
  ),
  record(
    "reykjavik",
    "visa",
    "Government of Iceland",
    "Iceland visa information",
    "https://island.is/en/do-you-need-a-visa",
  ),
  record(
    "reykjavik",
    "emergency",
    "Iceland emergency services",
    "Iceland emergency information",
    "https://www.112.is/en",
  ),
  record(
    "reykjavik",
    "closure",
    "Icelandic Road and Coastal Administration",
    "Iceland road conditions and closures",
    "https://umferdin.is/en",
  ),

  record(
    "bangkok",
    "weather_alert",
    "Thai Meteorological Department",
    "Thailand weather warnings",
    "https://www.tmd.go.th/en/warning-and-events/warning-storm",
  ),
  record(
    "bangkok",
    "holiday",
    "Bank of Thailand",
    "Thailand financial institution holidays",
    "https://www.bot.or.th/en/financial-institutions-holiday.html",
  ),
  record(
    "bangkok",
    "event",
    "Tourism Authority of Thailand",
    "Thailand official events and festivals",
    "https://www.tourismthailand.org/Events-and-Festivals",
  ),
  record(
    "bangkok",
    "visa",
    "Ministry of Foreign Affairs of Thailand",
    "Thailand electronic visa information",
    "https://www.thaievisa.go.th/",
  ),
  record(
    "bangkok",
    "emergency",
    "Tourism Authority of Thailand",
    "Thailand traveler emergency contacts",
    "https://www.tourismthailand.org/Articles/plan-your-trip-emergency-contact",
  ),
  record(
    "bangkok",
    "closure",
    "Bangkok Metropolitan Administration",
    "Bangkok transport and traffic information",
    "https://www.bangkok.go.th/traffic",
  ),
] as const;

function dataClass(category: OfficialSourceCategory): TravelDataClass {
  return category;
}

function expiresIn(category: OfficialSourceCategory) {
  if (category === "holiday") return 30 * 24 * 60 * 60_000;
  if (category === "weather_alert") return 60 * 60_000;
  return 6 * 60 * 60_000;
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Official-source request did not satisfy the normalized input contract.",
    false,
  );
}

function providerSource(
  link: OfficialSourceLink,
  retrievedAt: string,
  expiresAt: string,
): ProviderSource {
  return {
    attributionText: `Official source: ${link.authority}`,
    expiresAt,
    license: sourceLicense,
    locale: link.locale,
    offlineUseAllowed: false,
    provider,
    publishedAt: `${link.reviewedAt}T00:00:00Z`,
    quality: {
      confidence: 1,
      warnings: [
        "Follow the official link for current details; Roavia does not infer missing facts.",
      ],
    },
    redistributionAllowed: false,
    retrievedAt,
    sourceKind: "official_authority",
    sourceUrl: link.url,
    title: link.title,
    trustTier: "tier_1",
    validFrom: `${link.reviewedAt}T00:00:00Z`,
    validUntil: expiresAt,
  };
}

export class OfficialSourceRegistryAdapter implements TravelDataAdapter<
  OfficialSourceInput,
  OfficialSourceValue
> {
  readonly dataClass: TravelDataClass;
  readonly operation: string;
  readonly provider = provider;
  readonly #category: OfficialSourceCategory;
  readonly #clock: () => Date;
  readonly #records: readonly RegistryRecord[];

  constructor(input: {
    category: OfficialSourceCategory;
    clock?: () => Date;
    records?: readonly RegistryRecord[];
  }) {
    this.#category = input.category;
    this.#clock = input.clock ?? (() => new Date());
    this.#records = input.records ?? launchOfficialSourceRecords;
    this.dataClass = dataClass(input.category);
    this.operation = `official.${input.category}`;
  }

  supports(context: Pick<ProviderRequestContext, "locale">) {
    return context.locale === undefined || context.locale.toLowerCase().startsWith("en");
  }

  async execute(
    input: OfficialSourceInput,
    _context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<OfficialSourceValue>> {
    if (!isOfficialSourceInput(input) || input.category !== this.#category) {
      return invalidRequest(this.operation);
    }
    const links = this.#records.filter(
      (item) => item.category === input.category && item.destination === input.destination,
    );
    if (links.length === 0) {
      return {
        error: {
          code: "unsupported_coverage",
          message:
            "No reviewed official source is available for this launch destination and category.",
          retryable: false,
        },
        operation: this.operation,
        provider,
        reason: "unsupported_coverage",
        status: "unavailable",
      };
    }
    const now = this.#clock();
    const retrievedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + expiresIn(input.category)).toISOString();
    return {
      operation: this.operation,
      provider,
      sources: links.map((link) => providerSource(link, retrievedAt, expiresAt)),
      status: "success",
      usage: { costUnitName: "request", costUnits: 0, requests: 0 },
      value: {
        availability: "available",
        category: input.category,
        destination: input.destination,
        links,
      },
      warnings: [
        "The registry supplies reviewed official links, not a legal, safety, closure, event, or emergency guarantee.",
      ],
    };
  }
}
