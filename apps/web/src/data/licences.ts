// Licence notices, and the links that are part of them.
//
// Every source here obliges the credit to name the licence *and* point at its
// text: DL-DE-BY-2.0 §2 nr. 2 ("mit Verweis auf den Lizenztext"), CC BY 4.0
// §3(a)(1)(A)(iii). The manifest carries a licence string written by each
// pipeline, and those strings vary — en dashes or hyphens, "2.0" or
// "Version 2.0" — so they are matched loosely and rendered from one place.
//
// Unknown strings return null and the credit falls back to naming the source
// alone, which is the honest failure: better a missing annotation than a
// wrong one.

export interface LicenceRef {
  /** What the credit prints. For DL-DE the short form is licensed wording. */
  short: string;
  /** The licence text itself. */
  url: string;
}

const DL_DE: LicenceRef = {
  short: 'dl-de/by-2-0',
  url: 'https://www.govdata.de/dl-de/by-2-0',
};

const CC_BY_4: LicenceRef = {
  short: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
};

const NASA: LicenceRef = {
  short: 'NASA open data',
  url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy',
};

export function licenceRef(license?: string | null): LicenceRef | null {
  if (!license) return null;
  const s = license.toLowerCase();
  if (s.includes('dl-de') || s.includes('datenlizenz')) return DL_DE;
  if (s.includes('cc by 4') || s.includes('cc-by-4') || s.includes('creative commons attribution 4')) {
    return CC_BY_4;
  }
  if (s.includes('nasa')) return NASA;
  return null;
}
