// ============================================================================
// "In danger right now? Call ___" — the number that is true where the VISITOR
// is standing.
//
// The site is global but the safety notes were written with India's numbers
// (112, and the 1091 women's helpline). This module localises them with ZERO
// cost to the page: no network call, no permission prompt, no geolocation —
// the country comes from the browser's IANA timezone, which Intl hands over
// synchronously and which the app already depends on for clock formatting.
//
// Why the timezone and not the map or the locale:
//   - You dial where you STAND. The viewport may be showing another country;
//     the person reading "in danger right now" is not there.
//   - navigator.language is a trap: browsers ship with "en-US" everywhere, so
//     half the world would be told to call 911.
//
// The tables hold only countries whose immediate-danger number is NOT 112.
// 112 is the correct default for everything else: it is the EU's number,
// India's number, and the GSM standard that mobile networks route to local
// emergency services almost everywhere. Three outcomes:
//   - zone maps to a listed country      -> that country's number
//   - zone exists but is not listed      -> 112 (an unlisted country is one
//                                           where 112 is right, by construction)
//   - no usable timezone at all          -> India's full copy, the origin
//                                           default the static HTML already has
//
// A wrong emergency number is worse than none. Every entry below survived a
// three-stage review (regional compilation, adversarial fact-check against
// current government/consular sources, completeness audit); countries that
// could not be confirmed are OMITTED and inherit 112 — deliberately including
// North Korea, where no number is verifiable at all. The women's-helpline
// clause exists only where a single nationwide number is verified: India's
// 1091.
//
// tzdb quirk worth knowing: browsers report per-country zone names from CLDR
// even where tzdb links them (Ghana says Africa/Accra, not its tzdb anchor
// Africa/Abidjan) — so anchor zones never capture the wrong country here.
// ============================================================================

// iso2 -> the one number to dial in immediate danger (the unified emergency
// number where one exists nationwide, the police number otherwise).
const NUMBERS = {
  AE: '999',
  AG: '911',
  AI: '911',
  AO: '113',
  AR: '911',
  AS: '911',
  AU: '000',
  AW: '911',
  AZ: '102',
  BA: '122',
  BB: '211',
  BD: '999',
  BF: '17',
  BH: '999',
  BI: '117',
  BJ: '117',
  BM: '911',
  BN: '993',
  BO: '110',
  BQ: '911',
  BR: '190',
  BS: '911',
  BT: '113',
  BW: '999',
  BY: '102',
  BZ: '911',
  CA: '911',
  CI: '110',
  CK: '999',
  CL: '133',
  CM: '117',
  CN: '110',
  CO: '123',
  CR: '911',
  CU: '106',
  CV: '132',
  CW: '911',
  DJ: '17',
  DM: '999',
  DO: '911',
  DZ: '17',
  EC: '911',
  EG: '122',
  ET: '911',
  FJ: '911',
  FK: '999',
  FM: '911',
  GB: '999',
  GD: '911',
  GN: '117',
  GT: '110',
  GU: '911',
  GY: '911',
  HK: '999',
  HN: '911',
  HT: '114',
  ID: '110',
  IE: '999',
  IL: '100',
  IQ: '104',
  IR: '110',
  JM: '119',
  JO: '911',
  JP: '110',
  KE: '999',
  KH: '117',
  KN: '911',
  KR: '112',
  KY: '911',
  LA: '191',
  LC: '911',
  LK: '119',
  LR: '911',
  MA: '19',
  MG: '117',
  MH: '911',
  ML: '17',
  MM: '199',
  MN: '102',
  MO: '999',
  MP: '911',
  MR: '117',
  MS: '911',
  MV: '119',
  MW: '997',
  MX: '911',
  MY: '999',
  MZ: '119',
  NA: '10111',
  NE: '17',
  NI: '118',
  NP: '100',
  NZ: '111',
  OM: '9999',
  PA: '911',
  PE: '105',
  PH: '911',
  PK: '15',
  PR: '911',
  PS: '100',
  PW: '911',
  PY: '911',
  QA: '999',
  RS: '192',
  SA: '999',
  SB: '999',
  SD: '999',
  SG: '999',
  SL: '117',
  SN: '17',
  SR: '115',
  SV: '911',
  SX: '911',
  SZ: '999',
  TC: '911',
  TD: '17',
  TG: '117',
  TH: '191',
  TJ: '102',
  TN: '197',
  TO: '911',
  TT: '999',
  TW: '110',
  UA: '102',
  UG: '999',
  US: '911',
  UY: '911',
  UZ: '102',
  VC: '911',
  VE: '911',
  VG: '911',
  VI: '911',
  VN: '113',
  VU: '111',
  WS: '911',
  ZA: '10111',
  ZM: '999',
  ZW: '999',
};

// iso2 -> the FIRE AND AMBULANCE number, for countries that never unified.
//
// South Korea is why this exists. It has no single emergency number: 112 is the
// police and 119 is fire/rescue/medical, and a Korean reading a bare "112"
// sees the European number, not their own. Printing one digit-string for a
// country with two lines is not a rounding error — it can send someone who is
// bleeding to a police dispatcher. So where the split is real, both are shown
// and each is labelled. NUMBERS above stays the police / personal-danger line,
// which is what "in danger right now" most often means.
//
// Only genuine splits belong here. A country with a working unified line (911,
// 999, 000, 112) must NOT be listed — a second number there is noise in a
// sentence people read while frightened.
const FIRE_AMBULANCE = {
  KR: '119',   // 112 police / 119 fire, rescue, ambulance
};

// iso2 -> a single nationwide women-in-distress helpline. Only entries with a
// verified, memorable, country-wide number belong here — a wrong one is worse
// than showing none, which is why this is not attempted for 200 countries.
const WOMEN = { IN: '1091' };

// IANA zone -> iso2, for the countries above plus India (listed so its zone
// is recognised for the women's-helpline clause; its number is the 112
// default). Legacy aliases browsers still report are included (Asia/Calcutta,
// Europe/Kiev, US/Eastern, ...). Every key is validated against the IANA
// database by the test suite.
const ZONES = {
  // India
  'Asia/Calcutta': 'IN', 'Asia/Kolkata': 'IN',
  // United Arab Emirates
  'Asia/Dubai': 'AE',
  // Antigua and Barbuda
  'America/Antigua': 'AG',
  // Anguilla
  'America/Anguilla': 'AI',
  // Angola
  'Africa/Luanda': 'AO',
  // Argentina
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Catamarca': 'AR',
  'America/Argentina/ComodRivadavia': 'AR', 'America/Argentina/Cordoba': 'AR',
  'America/Argentina/Jujuy': 'AR', 'America/Argentina/La_Rioja': 'AR',
  'America/Argentina/Mendoza': 'AR', 'America/Argentina/Rio_Gallegos': 'AR',
  'America/Argentina/Salta': 'AR', 'America/Argentina/San_Juan': 'AR',
  'America/Argentina/San_Luis': 'AR', 'America/Argentina/Tucuman': 'AR',
  'America/Argentina/Ushuaia': 'AR', 'America/Buenos_Aires': 'AR', 'America/Catamarca': 'AR',
  'America/Cordoba': 'AR', 'America/Jujuy': 'AR', 'America/Mendoza': 'AR',
  'America/Rosario': 'AR',
  // American Samoa
  'Pacific/Pago_Pago': 'AS', 'Pacific/Samoa': 'AS', 'US/Samoa': 'AS',
  // Australia
  'Antarctica/Macquarie': 'AU', 'Australia/ACT': 'AU', 'Australia/Adelaide': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Broken_Hill': 'AU', 'Australia/Canberra': 'AU',
  'Australia/Currie': 'AU', 'Australia/Darwin': 'AU', 'Australia/Eucla': 'AU',
  'Australia/Hobart': 'AU', 'Australia/LHI': 'AU', 'Australia/Lindeman': 'AU',
  'Australia/Lord_Howe': 'AU', 'Australia/Melbourne': 'AU', 'Australia/NSW': 'AU',
  'Australia/North': 'AU', 'Australia/Perth': 'AU', 'Australia/Queensland': 'AU',
  'Australia/South': 'AU', 'Australia/Sydney': 'AU', 'Australia/Tasmania': 'AU',
  'Australia/Victoria': 'AU', 'Australia/West': 'AU', 'Australia/Yancowinna': 'AU',
  'Indian/Christmas': 'AU', 'Indian/Cocos': 'AU', 'Pacific/Norfolk': 'AU',
  // Aruba
  'America/Aruba': 'AW',
  // Azerbaijan
  'Asia/Baku': 'AZ',
  // Bosnia and Herzegovina
  'Europe/Sarajevo': 'BA',
  // Barbados
  'America/Barbados': 'BB',
  // Bangladesh
  'Asia/Dacca': 'BD', 'Asia/Dhaka': 'BD',
  // Burkina Faso
  'Africa/Ouagadougou': 'BF',
  // Bahrain
  'Asia/Bahrain': 'BH',
  // Burundi
  'Africa/Bujumbura': 'BI',
  // Benin
  'Africa/Porto-Novo': 'BJ',
  // Bermuda
  'Atlantic/Bermuda': 'BM',
  // Brunei
  'Asia/Brunei': 'BN',
  // Bolivia
  'America/La_Paz': 'BO',
  // Caribbean Netherlands (Bonaire, Sint Eustatius, Saba)
  'America/Kralendijk': 'BQ',
  // Brazil
  'America/Araguaina': 'BR', 'America/Bahia': 'BR', 'America/Belem': 'BR',
  'America/Boa_Vista': 'BR', 'America/Campo_Grande': 'BR', 'America/Cuiaba': 'BR',
  'America/Eirunepe': 'BR', 'America/Fortaleza': 'BR', 'America/Maceio': 'BR',
  'America/Manaus': 'BR', 'America/Noronha': 'BR', 'America/Porto_Acre': 'BR',
  'America/Porto_Velho': 'BR', 'America/Recife': 'BR', 'America/Rio_Branco': 'BR',
  'America/Santarem': 'BR', 'America/Sao_Paulo': 'BR', 'Brazil/Acre': 'BR',
  'Brazil/DeNoronha': 'BR', 'Brazil/East': 'BR', 'Brazil/West': 'BR',
  // Bahamas
  'America/Nassau': 'BS',
  // Bhutan
  'Asia/Thimbu': 'BT', 'Asia/Thimphu': 'BT',
  // Botswana
  'Africa/Gaborone': 'BW',
  // Belarus
  'Europe/Minsk': 'BY',
  // Belize
  'America/Belize': 'BZ',
  // Canada
  'America/Atikokan': 'CA', 'America/Blanc-Sablon': 'CA', 'America/Cambridge_Bay': 'CA',
  'America/Coral_Harbour': 'CA', 'America/Creston': 'CA', 'America/Dawson': 'CA',
  'America/Dawson_Creek': 'CA', 'America/Edmonton': 'CA', 'America/Fort_Nelson': 'CA',
  'America/Glace_Bay': 'CA', 'America/Goose_Bay': 'CA', 'America/Halifax': 'CA',
  'America/Inuvik': 'CA', 'America/Iqaluit': 'CA', 'America/Moncton': 'CA',
  'America/Montreal': 'CA', 'America/Nipigon': 'CA', 'America/Pangnirtung': 'CA',
  'America/Rainy_River': 'CA', 'America/Rankin_Inlet': 'CA', 'America/Regina': 'CA',
  'America/Resolute': 'CA', 'America/St_Johns': 'CA', 'America/Swift_Current': 'CA',
  'America/Thunder_Bay': 'CA', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Whitehorse': 'CA', 'America/Winnipeg': 'CA', 'America/Yellowknife': 'CA',
  'Canada/Atlantic': 'CA', 'Canada/Central': 'CA', 'Canada/Eastern': 'CA',
  'Canada/Mountain': 'CA', 'Canada/Newfoundland': 'CA', 'Canada/Pacific': 'CA',
  'Canada/Saskatchewan': 'CA', 'Canada/Yukon': 'CA',
  // Cote d'Ivoire
  'Africa/Abidjan': 'CI',
  // Cook Islands
  'Pacific/Rarotonga': 'CK',
  // Chile
  'America/Coyhaique': 'CL', 'America/Punta_Arenas': 'CL', 'America/Santiago': 'CL',
  'Chile/Continental': 'CL', 'Chile/EasterIsland': 'CL', 'Pacific/Easter': 'CL',
  // Cameroon
  'Africa/Douala': 'CM',
  // China
  'Asia/Chongqing': 'CN', 'Asia/Chungking': 'CN', 'Asia/Harbin': 'CN', 'Asia/Kashgar': 'CN',
  'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN', 'PRC': 'CN',
  // Colombia
  'America/Bogota': 'CO',
  // Costa Rica
  'America/Costa_Rica': 'CR',
  // Cuba
  'America/Havana': 'CU', 'Cuba': 'CU',
  // Cape Verde
  'Atlantic/Cape_Verde': 'CV',
  // Curacao
  'America/Curacao': 'CW',
  // Djibouti
  'Africa/Djibouti': 'DJ',
  // Dominica
  'America/Dominica': 'DM',
  // Dominican Republic
  'America/Santo_Domingo': 'DO',
  // Algeria
  'Africa/Algiers': 'DZ',
  // Ecuador
  'America/Guayaquil': 'EC', 'Pacific/Galapagos': 'EC',
  // Egypt
  'Africa/Cairo': 'EG', 'Egypt': 'EG',
  // Ethiopia
  'Africa/Addis_Ababa': 'ET',
  // Fiji
  'Pacific/Fiji': 'FJ',
  // Falkland Islands
  'Atlantic/Stanley': 'FK',
  // Micronesia (Federated States)
  'Pacific/Chuuk': 'FM', 'Pacific/Kosrae': 'FM', 'Pacific/Pohnpei': 'FM', 'Pacific/Ponape': 'FM',
  'Pacific/Truk': 'FM', 'Pacific/Yap': 'FM',
  // United Kingdom
  'Europe/Belfast': 'GB', 'Europe/Gibraltar': 'GB', 'Europe/Guernsey': 'GB',
  'Europe/Isle_of_Man': 'GB', 'Europe/Jersey': 'GB', 'Europe/London': 'GB', 'GB': 'GB',
  'GB-Eire': 'GB',
  // Grenada
  'America/Grenada': 'GD',
  // Guinea
  'Africa/Conakry': 'GN',
  // Guatemala
  'America/Guatemala': 'GT',
  // Guam
  'Pacific/Guam': 'GU',
  // Guyana
  'America/Guyana': 'GY',
  // Hong Kong
  'Asia/Hong_Kong': 'HK', 'Hongkong': 'HK',
  // Honduras
  'America/Tegucigalpa': 'HN',
  // Haiti
  'America/Port-au-Prince': 'HT',
  // Indonesia
  'Asia/Jakarta': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Makassar': 'ID', 'Asia/Pontianak': 'ID',
  'Asia/Ujung_Pandang': 'ID',
  // Ireland
  'Eire': 'IE', 'Europe/Dublin': 'IE',
  // Israel
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Israel': 'IL',
  // Iraq
  'Asia/Baghdad': 'IQ',
  // Iran
  'Asia/Tehran': 'IR', 'Iran': 'IR',
  // Jamaica
  'America/Jamaica': 'JM', 'Jamaica': 'JM',
  // Jordan
  'Asia/Amman': 'JO',
  // Japan
  'Asia/Tokyo': 'JP', 'Japan': 'JP',
  // Kenya
  'Africa/Nairobi': 'KE',
  // Cambodia
  'Asia/Phnom_Penh': 'KH',
  // Saint Kitts and Nevis
  'America/St_Kitts': 'KN',
  // South Korea — listed even though its police line IS 112, so the 119
  // fire/ambulance half is shown rather than left to look like our default.
  'Asia/Seoul': 'KR', 'ROK': 'KR',
  // Cayman Islands
  'America/Cayman': 'KY',
  // Laos
  'Asia/Vientiane': 'LA',
  // Saint Lucia
  'America/St_Lucia': 'LC',
  // Sri Lanka
  'Asia/Colombo': 'LK',
  // Liberia
  'Africa/Monrovia': 'LR',
  // Morocco
  'Africa/Casablanca': 'MA', 'Africa/El_Aaiun': 'MA',
  // Madagascar
  'Indian/Antananarivo': 'MG',
  // Marshall Islands
  'Kwajalein': 'MH', 'Pacific/Kwajalein': 'MH', 'Pacific/Majuro': 'MH',
  // Mali
  'Africa/Bamako': 'ML', 'Africa/Timbuktu': 'ML',
  // Myanmar
  'Asia/Rangoon': 'MM', 'Asia/Yangon': 'MM',
  // Mongolia
  'Asia/Choibalsan': 'MN', 'Asia/Hovd': 'MN', 'Asia/Ulaanbaatar': 'MN', 'Asia/Ulan_Bator': 'MN',
  // Macau
  'Asia/Macao': 'MO', 'Asia/Macau': 'MO',
  // Northern Mariana Islands
  'Pacific/Saipan': 'MP',
  // Mauritania
  'Africa/Nouakchott': 'MR',
  // Montserrat
  'America/Montserrat': 'MS',
  // Maldives
  'Indian/Maldives': 'MV',
  // Malawi
  'Africa/Blantyre': 'MW',
  // Mexico
  'America/Bahia_Banderas': 'MX', 'America/Cancun': 'MX', 'America/Chihuahua': 'MX',
  'America/Ciudad_Juarez': 'MX', 'America/Ensenada': 'MX', 'America/Hermosillo': 'MX',
  'America/Matamoros': 'MX', 'America/Mazatlan': 'MX', 'America/Merida': 'MX',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Ojinaga': 'MX',
  'America/Santa_Isabel': 'MX', 'America/Tijuana': 'MX', 'Mexico/BajaNorte': 'MX',
  'Mexico/BajaSur': 'MX', 'Mexico/General': 'MX',
  // Malaysia
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY',
  // Mozambique
  'Africa/Maputo': 'MZ',
  // Namibia
  'Africa/Windhoek': 'NA',
  // Niger
  'Africa/Niamey': 'NE',
  // Nicaragua
  'America/Managua': 'NI',
  // Nepal
  'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP',
  // New Zealand
  'Antarctica/McMurdo': 'NZ', 'Antarctica/South_Pole': 'NZ', 'NZ': 'NZ', 'NZ-CHAT': 'NZ',
  'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ',
  // Oman
  'Asia/Muscat': 'OM',
  // Panama
  'America/Panama': 'PA',
  // Peru
  'America/Lima': 'PE',
  // Philippines
  'Asia/Manila': 'PH',
  // Pakistan
  'Asia/Karachi': 'PK',
  // Puerto Rico
  'America/Puerto_Rico': 'PR',
  // Palestine
  'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS',
  // Palau
  'Pacific/Palau': 'PW',
  // Paraguay
  'America/Asuncion': 'PY',
  // Qatar
  'Asia/Qatar': 'QA',
  // Serbia
  'Europe/Belgrade': 'RS',
  // Saudi Arabia
  'Asia/Riyadh': 'SA',
  // Solomon Islands
  'Pacific/Guadalcanal': 'SB',
  // Sudan
  'Africa/Khartoum': 'SD',
  // Singapore
  'Asia/Singapore': 'SG', 'Singapore': 'SG',
  // Sierra Leone
  'Africa/Freetown': 'SL',
  // Senegal
  'Africa/Dakar': 'SN',
  // Suriname
  'America/Paramaribo': 'SR',
  // El Salvador
  'America/El_Salvador': 'SV',
  // Sint Maarten
  'America/Lower_Princes': 'SX',
  // Eswatini
  'Africa/Mbabane': 'SZ',
  // Turks and Caicos Islands
  'America/Grand_Turk': 'TC',
  // Chad
  'Africa/Ndjamena': 'TD',
  // Togo
  'Africa/Lome': 'TG',
  // Thailand
  'Asia/Bangkok': 'TH',
  // Tajikistan
  'Asia/Dushanbe': 'TJ',
  // Tunisia
  'Africa/Tunis': 'TN',
  // Tonga
  'Pacific/Tongatapu': 'TO',
  // Trinidad and Tobago
  'America/Port_of_Spain': 'TT',
  // Taiwan
  'Asia/Taipei': 'TW', 'ROC': 'TW',
  // Ukraine
  'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Uzhgorod': 'UA', 'Europe/Zaporozhye': 'UA',
  // Uganda
  'Africa/Kampala': 'UG',
  // United States
  'America/Adak': 'US', 'America/Anchorage': 'US', 'America/Atka': 'US', 'America/Boise': 'US',
  'America/Chicago': 'US', 'America/Denver': 'US', 'America/Detroit': 'US',
  'America/Fort_Wayne': 'US', 'America/Indiana/Indianapolis': 'US', 'America/Indiana/Knox': 'US',
  'America/Indiana/Marengo': 'US', 'America/Indiana/Petersburg': 'US',
  'America/Indiana/Tell_City': 'US', 'America/Indiana/Vevay': 'US',
  'America/Indiana/Vincennes': 'US', 'America/Indiana/Winamac': 'US',
  'America/Indianapolis': 'US', 'America/Juneau': 'US', 'America/Kentucky/Louisville': 'US',
  'America/Kentucky/Monticello': 'US', 'America/Knox_IN': 'US', 'America/Los_Angeles': 'US',
  'America/Louisville': 'US', 'America/Menominee': 'US', 'America/Metlakatla': 'US',
  'America/New_York': 'US', 'America/Nome': 'US', 'America/North_Dakota/Beulah': 'US',
  'America/North_Dakota/Center': 'US', 'America/North_Dakota/New_Salem': 'US',
  'America/Phoenix': 'US', 'America/Shiprock': 'US', 'America/Sitka': 'US',
  'America/Yakutat': 'US', 'Navajo': 'US', 'Pacific/Honolulu': 'US', 'Pacific/Johnston': 'US',
  'US/Alaska': 'US', 'US/Aleutian': 'US', 'US/Arizona': 'US', 'US/Central': 'US',
  'US/East-Indiana': 'US', 'US/Eastern': 'US', 'US/Hawaii': 'US', 'US/Indiana-Starke': 'US',
  'US/Michigan': 'US', 'US/Mountain': 'US', 'US/Pacific': 'US',
  // Uruguay
  'America/Montevideo': 'UY',
  // Uzbekistan
  'Asia/Samarkand': 'UZ', 'Asia/Tashkent': 'UZ',
  // Saint Vincent and the Grenadines
  'America/St_Vincent': 'VC',
  // Venezuela
  'America/Caracas': 'VE',
  // British Virgin Islands
  'America/Tortola': 'VG',
  // US Virgin Islands
  'America/St_Thomas': 'VI', 'America/Virgin': 'VI',
  // Vietnam
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  // Vanuatu
  'Pacific/Efate': 'VU',
  // Samoa
  'Pacific/Apia': 'WS',
  // South Africa
  'Africa/Johannesburg': 'ZA',
  // Zambia
  'Africa/Lusaka': 'ZM',
  // Zimbabwe
  'Africa/Harare': 'ZW',
};

/**
 * The emergency numbers for wherever the visitor is.
 * @param zoneOverride  test hook — pass an IANA zone instead of asking Intl.
 * @returns {{ number: string, fire: string|null, women: string|null }}
 *          number = police / immediate-danger line; fire = the separate
 *          fire-and-ambulance line where the country has one; women = a
 *          nationwide women's helpline where one is verified.
 */
export function localEmergency(zoneOverride) {
  let zone = zoneOverride;
  if (zone === undefined) {
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = null; }
  }
  // No signal at all -> the origin default, exactly what the static HTML says.
  if (!zone) return { number: '112', fire: null, women: WOMEN.IN };
  const iso = ZONES[zone];
  // A country not in the tables is one where 112 is correct, by construction.
  if (!iso) return { number: '112', fire: null, women: null };
  return {
    number: NUMBERS[iso] ?? '112',
    fire: FIRE_AMBULANCE[iso] ?? null,
    women: WOMEN[iso] ?? null,
  };
}

/**
 * That, as the sentence the safety notes print. Kept here beside the data so
 * the three places that show it can never word it three different ways.
 * @param joiner  ' — ' in the notes, ' (' … in the About dialog's parenthetical
 */
export function emergencyLine(zoneOverride, { parenthetical = false } = {}) {
  const { number, fire, women } = localEmergency(zoneOverride);
  let line = fire ? `${number} for police, ${fire} for fire or ambulance` : number;
  if (women) line += parenthetical ? ` (women's helpline ${women})` : ` — women's helpline ${women}`;
  return line;
}
