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
// 112 is the default for anything not listed: it is the EU's number, India's,
// and the GSM standard mobile networks route to local emergency services
// almost everywhere. Three outcomes:
//   - zone maps to a listed country      -> that country's number(s)
//   - zone exists but is not listed      -> 112 (an unlisted country is one
//                                           where 112 is right, by construction)
//   - no usable timezone at all          -> India's full copy, the origin
//                                           default the static HTML already has
//
// A country is listed for one of two reasons: 112 is WRONG there, or 112 is
// merely INCOMPLETE there — it reaches police but not an ambulance. The second
// case is South Korea's, and it is the one that shipped as a bug: Korea was
// absent, inherited the 112 default, and 112 happens to be Korea's police
// number, so the mistake looked like a correct answer until a Korean said
// otherwise. Nothing here may rely on someone remembering to add a country.
//
// KEEPING THIS HONEST: subtract the ZONES keys below from
// Intl.supportedValuesOf('timeZone') and whatever remains is exactly the set of
// visitors being shown the default. Every one of those has been checked and
// confirmed as genuinely-112. Re-run that subtraction after any edit — a
// country nobody thought to check is the only failure mode this design has.
//
// A wrong emergency number is worse than none. Every entry survived regional
// compilation, an adversarial fact-check against government/consular sources
// (UK FCDO, State Dept, national agencies), and a completeness audit; anything
// unconfirmed is OMITTED and inherits the default. Knowingly left there, each
// checked and each a dead end rather than an oversight: North Korea, Syria,
// Equatorial Guinea, Republic of the Congo, South Sudan, Tokelau, and the
// uninhabited US Minor Outlying Islands — no authority publishes a dialable
// number for any of them. The women's-helpline clause exists only where a
// single nationwide number is verified: India's 1091.
//
// tzdb quirk worth knowing: browsers report per-country zone names from CLDR
// even where tzdb links them (Ghana says Africa/Accra, not its tzdb anchor
// Africa/Abidjan) — so anchor zones never capture the wrong country here.
// ============================================================================

// iso2 -> the one number to dial in immediate danger (the unified emergency
// number where one exists nationwide, the police number otherwise).
const NUMBERS = {
  AE: '999',
  AF: '119',
  AG: '911',
  AI: '911',
  AL: '112',
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
  CF: '117',
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
  ER: '113',
  ET: '911',
  FJ: '911',
  FK: '999',
  FM: '911',
  GA: '177',
  GB: '999',
  GD: '911',
  GM: '117',
  GN: '117',
  GT: '110',
  GU: '911',
  GW: '117',
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
  KM: '117',
  KN: '911',
  KR: '112',
  KY: '911',
  LA: '191',
  LB: '112',
  LC: '911',
  LK: '119',
  LR: '911',
  LY: '1415',
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
  NC: '17',
  NE: '17',
  NI: '118',
  NO: '112',
  NP: '100',
  NR: '110',
  NU: '999',
  NZ: '111',
  OM: '9999',
  PA: '911',
  PE: '105',
  PF: '17',
  PG: '112',
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
  SC: '999',
  SD: '999',
  SG: '999',
  SH: '999',
  SL: '117',
  SN: '17',
  SO: '888',
  SR: '115',
  ST: '113',
  SV: '911',
  SX: '911',
  SZ: '999',
  TC: '911',
  TD: '17',
  TG: '117',
  TH: '191',
  TJ: '102',
  TL: '112',
  TM: '002',
  TN: '197',
  TO: '911',
  TT: '999',
  TV: '911',
  TW: '110',
  UG: '999',
  US: '911',
  UY: '911',
  VC: '911',
  VE: '911',
  VG: '911',
  VI: '911',
  VN: '113',
  VU: '111',
  WF: '17',
  WS: '911',
  XN: '155',
  YE: '199',
  ZA: '10111',
  ZM: '999',
  ZW: '999',
};

// iso2 -> [number, what it actually reaches], for countries that never
// unified their emergency services.
//
// South Korea is why this exists. It has no single emergency number: 112 is
// the police and 119 is fire/rescue/medical, and a Korean reading a bare "112"
// sees the European number, not their own. Printing one digit-string for a
// country with two lines is not a rounding error — it can send someone who is
// bleeding to a police dispatcher. NUMBERS above stays the police /
// personal-danger line, which is what "in danger right now" usually means;
// this is the other one.
//
// THE LABEL IS PART OF THE DATA, and that is not decoration. Most countries
// here run three separate services, so this number is the AMBULANCE and fire
// is a third line we do not show; only a minority (Korea, Japan, Taiwan,
// Singapore, Jamaica...) genuinely combine fire and ambulance. An earlier
// draft hardcoded "for fire or ambulance" for all of them, which would have
// told someone in the Comoros to summon an ambulance on 113 — the fire line,
// in a country with no ambulance dispatch at all. Never reintroduce a fixed
// label; if a new entry's service cannot be established, omit the entry.
//
// Only genuine splits belong here. A country with a working unified line (911,
// 999, 000, and 112 across the EU/EEA) must NOT be listed — a second number
// there is noise in a sentence people read while frightened.
const SECOND_LINE = {
  AE: ['998', 'an ambulance'],
  AL: ['127', 'an ambulance'],
  AO: ['112', 'an ambulance'],
  AZ: ['103', 'an ambulance'],
  BA: ['124', 'an ambulance'],
  BB: ['511', 'an ambulance'],
  BF: ['18', 'fire or an ambulance'],
  BJ: ['118', 'an ambulance'],
  BN: ['991', 'an ambulance'],
  BO: ['118', 'an ambulance'],
  BR: ['192', 'an ambulance'],
  BT: ['112', 'an ambulance'],
  BW: ['997', 'an ambulance'],
  BY: ['103', 'an ambulance'],
  CI: ['185', 'an ambulance'],
  CL: ['131', 'an ambulance'],
  CM: ['112', 'an ambulance'],
  CN: ['120', 'an ambulance'],
  CU: ['104', 'an ambulance'],
  CV: ['130', 'an ambulance'],
  CW: ['912', 'an ambulance'],
  DJ: ['18', 'an ambulance'],
  DZ: ['1021', 'an ambulance'],
  EG: ['123', 'an ambulance'],
  ER: ['122244', 'an ambulance'],
  ET: ['907', 'an ambulance'],
  GA: ['1300', 'an ambulance'],
  GM: ['116', 'an ambulance'],
  GT: ['122', 'fire or an ambulance'],
  GW: ['1313', 'fire or an ambulance'],
  GY: ['913', 'an ambulance'],
  HT: ['116', 'an ambulance'],
  ID: ['118', 'an ambulance'],
  IL: ['101', 'an ambulance'],
  IQ: ['122', 'an ambulance'],
  IR: ['115', 'an ambulance'],
  JM: ['110', 'fire or an ambulance'],
  JP: ['119', 'fire or an ambulance'],
  KH: ['119', 'an ambulance'],
  KM: ['113', 'fire'],
  KR: ['119', 'fire or an ambulance'],
  LB: ['140', 'an ambulance'],
  LK: ['1990', 'an ambulance'],
  ML: ['15', 'an ambulance'],
  MM: ['192', 'an ambulance'],
  MN: ['103', 'an ambulance'],
  MR: ['101', 'an ambulance'],
  MV: ['102', 'an ambulance'],
  MW: ['998', 'an ambulance'],
  NC: ['18', 'fire or an ambulance'],
  NE: ['15', 'an ambulance'],
  NO: ['113', 'an ambulance'],
  NP: ['102', 'an ambulance'],
  NR: ['111', 'an ambulance'],
  PE: ['106', 'an ambulance'],
  PF: ['18', 'fire or an ambulance'],
  PG: ['111', 'an ambulance'],
  PK: ['1122', 'fire or an ambulance'],
  PS: ['101', 'an ambulance'],
  PY: ['141', 'an ambulance'],
  RS: ['194', 'an ambulance'],
  SB: ['111', 'an ambulance'],
  SG: ['995', 'fire or an ambulance'],
  SN: ['15', 'an ambulance'],
  SO: ['999', 'an ambulance'],
  ST: ['222 22 22', 'an ambulance'],
  SX: ['912', 'an ambulance'],
  SZ: ['977', 'an ambulance'],
  TG: ['8200', 'an ambulance'],
  TL: ['110', 'an ambulance'],
  TN: ['190', 'an ambulance'],
  TT: ['811', 'an ambulance'],
  TW: ['119', 'fire or an ambulance'],
  VN: ['115', 'an ambulance'],
  VU: ['115', 'an ambulance'],
  WF: ['18', 'fire or an ambulance'],
  XN: ['112', 'an ambulance'],
  YE: ['191', 'fire or an ambulance'],
  ZA: ['10177', 'fire or an ambulance'],
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
  'Asia/Calcutta': 'IN', 'Asia/Kolkata': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Kabul': 'AF',
  'America/Antigua': 'AG',
  'America/Anguilla': 'AI',
  'Europe/Tirane': 'AL',
  'Africa/Luanda': 'AO',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Catamarca': 'AR',
  'America/Argentina/ComodRivadavia': 'AR', 'America/Argentina/Cordoba': 'AR',
  'America/Argentina/Jujuy': 'AR', 'America/Argentina/La_Rioja': 'AR',
  'America/Argentina/Mendoza': 'AR', 'America/Argentina/Rio_Gallegos': 'AR',
  'America/Argentina/Salta': 'AR', 'America/Argentina/San_Juan': 'AR',
  'America/Argentina/San_Luis': 'AR', 'America/Argentina/Tucuman': 'AR',
  'America/Argentina/Ushuaia': 'AR', 'America/Buenos_Aires': 'AR', 'America/Catamarca': 'AR',
  'America/Cordoba': 'AR', 'America/Jujuy': 'AR', 'America/Mendoza': 'AR',
  'America/Rosario': 'AR',
  'Pacific/Pago_Pago': 'AS', 'Pacific/Samoa': 'AS', 'US/Samoa': 'AS',
  'Antarctica/Macquarie': 'AU', 'Australia/ACT': 'AU', 'Australia/Adelaide': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Broken_Hill': 'AU', 'Australia/Canberra': 'AU',
  'Australia/Currie': 'AU', 'Australia/Darwin': 'AU', 'Australia/Eucla': 'AU',
  'Australia/Hobart': 'AU', 'Australia/LHI': 'AU', 'Australia/Lindeman': 'AU',
  'Australia/Lord_Howe': 'AU', 'Australia/Melbourne': 'AU', 'Australia/NSW': 'AU',
  'Australia/North': 'AU', 'Australia/Perth': 'AU', 'Australia/Queensland': 'AU',
  'Australia/South': 'AU', 'Australia/Sydney': 'AU', 'Australia/Tasmania': 'AU',
  'Australia/Victoria': 'AU', 'Australia/West': 'AU', 'Australia/Yancowinna': 'AU',
  'Indian/Christmas': 'AU', 'Indian/Cocos': 'AU', 'Pacific/Norfolk': 'AU',
  'America/Aruba': 'AW',
  'Asia/Baku': 'AZ',
  'Europe/Sarajevo': 'BA',
  'America/Barbados': 'BB',
  'Asia/Dacca': 'BD', 'Asia/Dhaka': 'BD',
  'Africa/Ouagadougou': 'BF',
  'Asia/Bahrain': 'BH',
  'Africa/Bujumbura': 'BI',
  'Africa/Porto-Novo': 'BJ',
  'Atlantic/Bermuda': 'BM',
  'Asia/Brunei': 'BN',
  'America/La_Paz': 'BO',
  'America/Kralendijk': 'BQ',
  'America/Araguaina': 'BR', 'America/Bahia': 'BR', 'America/Belem': 'BR',
  'America/Boa_Vista': 'BR', 'America/Campo_Grande': 'BR', 'America/Cuiaba': 'BR',
  'America/Eirunepe': 'BR', 'America/Fortaleza': 'BR', 'America/Maceio': 'BR',
  'America/Manaus': 'BR', 'America/Noronha': 'BR', 'America/Porto_Acre': 'BR',
  'America/Porto_Velho': 'BR', 'America/Recife': 'BR', 'America/Rio_Branco': 'BR',
  'America/Santarem': 'BR', 'America/Sao_Paulo': 'BR', 'Brazil/Acre': 'BR',
  'Brazil/DeNoronha': 'BR', 'Brazil/East': 'BR', 'Brazil/West': 'BR',
  'America/Nassau': 'BS',
  'Asia/Thimbu': 'BT', 'Asia/Thimphu': 'BT',
  'Africa/Gaborone': 'BW',
  'Europe/Minsk': 'BY',
  'America/Belize': 'BZ',
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
  'Africa/Bangui': 'CF',
  'Africa/Abidjan': 'CI',
  'Pacific/Rarotonga': 'CK',
  'America/Coyhaique': 'CL', 'America/Punta_Arenas': 'CL', 'America/Santiago': 'CL',
  'Chile/Continental': 'CL', 'Chile/EasterIsland': 'CL', 'Pacific/Easter': 'CL',
  'Africa/Douala': 'CM',
  'Asia/Chongqing': 'CN', 'Asia/Chungking': 'CN', 'Asia/Harbin': 'CN', 'Asia/Kashgar': 'CN',
  'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN', 'PRC': 'CN',
  'America/Bogota': 'CO',
  'America/Costa_Rica': 'CR',
  'America/Havana': 'CU', 'Cuba': 'CU',
  'Atlantic/Cape_Verde': 'CV',
  'America/Curacao': 'CW',
  'Africa/Djibouti': 'DJ',
  'America/Dominica': 'DM',
  'America/Santo_Domingo': 'DO',
  'Africa/Algiers': 'DZ',
  'America/Guayaquil': 'EC', 'Pacific/Galapagos': 'EC',
  'Africa/Cairo': 'EG', 'Egypt': 'EG',
  'Africa/Asmara': 'ER', 'Africa/Asmera': 'ER',
  'Africa/Addis_Ababa': 'ET',
  'Pacific/Fiji': 'FJ',
  'Atlantic/Stanley': 'FK',
  'Pacific/Chuuk': 'FM', 'Pacific/Kosrae': 'FM', 'Pacific/Pohnpei': 'FM', 'Pacific/Ponape': 'FM',
  'Pacific/Truk': 'FM', 'Pacific/Yap': 'FM',
  'Africa/Libreville': 'GA',
  'Europe/Belfast': 'GB', 'Europe/Gibraltar': 'GB', 'Europe/Guernsey': 'GB',
  'Europe/Isle_of_Man': 'GB', 'Europe/Jersey': 'GB', 'Europe/London': 'GB', 'GB': 'GB',
  'GB-Eire': 'GB',
  'America/Grenada': 'GD',
  'Africa/Banjul': 'GM',
  'Africa/Conakry': 'GN',
  'America/Guatemala': 'GT',
  'Pacific/Guam': 'GU',
  'Africa/Bissau': 'GW',
  'America/Guyana': 'GY',
  'Asia/Hong_Kong': 'HK', 'Hongkong': 'HK',
  'America/Tegucigalpa': 'HN',
  'America/Port-au-Prince': 'HT',
  'Asia/Jakarta': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Makassar': 'ID', 'Asia/Pontianak': 'ID',
  'Asia/Ujung_Pandang': 'ID',
  'Eire': 'IE', 'Europe/Dublin': 'IE',
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Israel': 'IL',
  'Asia/Baghdad': 'IQ',
  'Asia/Tehran': 'IR', 'Iran': 'IR',
  'America/Jamaica': 'JM', 'Jamaica': 'JM',
  'Asia/Amman': 'JO',
  'Asia/Tokyo': 'JP', 'Japan': 'JP',
  'Africa/Nairobi': 'KE',
  'Asia/Phnom_Penh': 'KH',
  'Indian/Comoro': 'KM',
  'America/St_Kitts': 'KN',
  'Asia/Seoul': 'KR', 'ROK': 'KR',
  'America/Cayman': 'KY',
  'Asia/Vientiane': 'LA',
  'Asia/Beirut': 'LB',
  'America/St_Lucia': 'LC',
  'Asia/Colombo': 'LK',
  'Africa/Monrovia': 'LR',
  'Africa/Tripoli': 'LY',
  'Africa/Casablanca': 'MA', 'Africa/El_Aaiun': 'MA',
  'Indian/Antananarivo': 'MG',
  'Kwajalein': 'MH', 'Pacific/Kwajalein': 'MH', 'Pacific/Majuro': 'MH',
  'Africa/Bamako': 'ML', 'Africa/Timbuktu': 'ML',
  'Asia/Rangoon': 'MM', 'Asia/Yangon': 'MM',
  'Asia/Choibalsan': 'MN', 'Asia/Hovd': 'MN', 'Asia/Ulaanbaatar': 'MN', 'Asia/Ulan_Bator': 'MN',
  'Asia/Macao': 'MO', 'Asia/Macau': 'MO',
  'Pacific/Saipan': 'MP',
  'Africa/Nouakchott': 'MR',
  'America/Montserrat': 'MS',
  'Indian/Maldives': 'MV',
  'Africa/Blantyre': 'MW',
  'America/Bahia_Banderas': 'MX', 'America/Cancun': 'MX', 'America/Chihuahua': 'MX',
  'America/Ciudad_Juarez': 'MX', 'America/Ensenada': 'MX', 'America/Hermosillo': 'MX',
  'America/Matamoros': 'MX', 'America/Mazatlan': 'MX', 'America/Merida': 'MX',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Ojinaga': 'MX',
  'America/Santa_Isabel': 'MX', 'America/Tijuana': 'MX', 'Mexico/BajaNorte': 'MX',
  'Mexico/BajaSur': 'MX', 'Mexico/General': 'MX',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY',
  'Africa/Maputo': 'MZ',
  'Africa/Windhoek': 'NA',
  'Pacific/Noumea': 'NC',
  'Africa/Niamey': 'NE',
  'America/Managua': 'NI',
  'Arctic/Longyearbyen': 'NO', 'Atlantic/Jan_Mayen': 'NO', 'Europe/Oslo': 'NO',
  'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP',
  'Pacific/Nauru': 'NR',
  'Pacific/Niue': 'NU',
  'Antarctica/McMurdo': 'NZ', 'Antarctica/South_Pole': 'NZ', 'NZ': 'NZ', 'NZ-CHAT': 'NZ',
  'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ',
  'Asia/Muscat': 'OM',
  'America/Panama': 'PA',
  'America/Lima': 'PE',
  'Pacific/Gambier': 'PF', 'Pacific/Marquesas': 'PF', 'Pacific/Tahiti': 'PF',
  'Pacific/Bougainville': 'PG', 'Pacific/Port_Moresby': 'PG',
  'Asia/Manila': 'PH',
  'Asia/Karachi': 'PK',
  'America/Puerto_Rico': 'PR',
  'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS',
  'Pacific/Palau': 'PW',
  'America/Asuncion': 'PY',
  'Asia/Qatar': 'QA',
  'Europe/Belgrade': 'RS',
  'Asia/Riyadh': 'SA',
  'Pacific/Guadalcanal': 'SB',
  'Indian/Mahe': 'SC',
  'Africa/Khartoum': 'SD',
  'Asia/Singapore': 'SG', 'Singapore': 'SG',
  'Atlantic/St_Helena': 'SH',
  'Africa/Freetown': 'SL',
  'Africa/Dakar': 'SN',
  'Africa/Mogadishu': 'SO',
  'America/Paramaribo': 'SR',
  'Africa/Sao_Tome': 'ST',
  'America/El_Salvador': 'SV',
  'America/Lower_Princes': 'SX',
  'Africa/Mbabane': 'SZ',
  'America/Grand_Turk': 'TC',
  'Africa/Ndjamena': 'TD',
  'Africa/Lome': 'TG',
  'Asia/Bangkok': 'TH',
  'Asia/Dushanbe': 'TJ',
  'Asia/Dili': 'TL',
  'Asia/Ashgabat': 'TM', 'Asia/Ashkhabad': 'TM',
  'Africa/Tunis': 'TN',
  'Pacific/Tongatapu': 'TO',
  'America/Port_of_Spain': 'TT',
  'Pacific/Funafuti': 'TV',
  'Asia/Taipei': 'TW', 'ROC': 'TW',
  'Africa/Kampala': 'UG',
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
  'America/Montevideo': 'UY',
  'America/St_Vincent': 'VC',
  'America/Caracas': 'VE',
  'America/Tortola': 'VG',
  'America/St_Thomas': 'VI', 'America/Virgin': 'VI',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  'Pacific/Efate': 'VU',
  'Pacific/Wallis': 'WF',
  'Pacific/Apia': 'WS',
  'Asia/Famagusta': 'XN',
  'Asia/Aden': 'YE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lusaka': 'ZM',
  'Africa/Harare': 'ZW',
};

/**
 * The emergency numbers for wherever the visitor is.
 * @param zoneOverride  test hook — pass an IANA zone instead of asking Intl.
 * @returns {{ number: string, second: [string, string]|null, women: string|null }}
 *          number = police / immediate-danger line; second = [number, what it
 *          reaches] where the country never unified its services; women = a
 *          nationwide women's helpline where one is verified.
 */
export function localEmergency(zoneOverride) {
  let zone = zoneOverride;
  if (zone === undefined) {
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = null; }
  }
  // No signal at all -> the origin default, exactly what the static HTML says.
  if (!zone) return { number: '112', second: null, women: WOMEN.IN };
  const iso = ZONES[zone];
  // A country not in the tables is one where 112 is correct, by construction.
  if (!iso) return { number: '112', second: null, women: null };
  return {
    number: NUMBERS[iso] ?? '112',
    second: SECOND_LINE[iso] ?? null,
    women: WOMEN[iso] ?? null,
  };
}

/**
 * That, as the sentence the safety notes print. Kept here beside the data so
 * the three places that show it can never word it three different ways.
 * @param joiner  ' — ' in the notes, ' (' … in the About dialog's parenthetical
 */
export function emergencyLine(zoneOverride, { parenthetical = false } = {}) {
  const { number, second, women } = localEmergency(zoneOverride);
  let line = second ? `${number} for police, ${second[0]} for ${second[1]}` : number;
  if (women) line += parenthetical ? ` (women's helpline ${women})` : ` — women's helpline ${women}`;
  return line;
}
