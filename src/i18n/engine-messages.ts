/**
 * Strings the runtime engine writes itself ("Saved", "Updated", "Deleted", validation messages), in the
 * language of the app (`spec.lang`), not the language of Kalam's own screens (docs/10 §14.1).
 *
 * These live in code, not in the locale JSON, on purpose: the engine is synchronous, runs offline and
 * must never wait for a catalogue to load. An app whose language has no entry here (for example French)
 * gets English. Field labels (`{label}`) come from the spec and are inserted as they are.
 *
 * Drafted by an AI model. Needs native review, like the locale files.
 * Pure TypeScript.
 */
import { createFormatter } from './format';
import { interpolate } from './interpolate';
import { resolveLanguage, type LanguageCode } from './languages';
import type { TranslateParams } from './types';

export type EngineKey =
  | 'saved'
  | 'updated'
  | 'deleted'
  | 'formulaFailed'
  | 'required'
  | 'mustBeYesNo'
  | 'mustBeNumber'
  | 'min'
  | 'max'
  | 'maxLength'
  | 'mustBeDate'
  | 'chooseOption';

export const ENGINE_KEYS: readonly EngineKey[] = [
  'saved', 'updated', 'deleted', 'formulaFailed', 'required', 'mustBeYesNo',
  'mustBeNumber', 'min', 'max', 'maxLength', 'mustBeDate', 'chooseOption',
];

type Table = Record<EngineKey, string>;

export const ENGINE_MESSAGES: Record<LanguageCode, Table> = {
  en: {
    saved: 'Saved',
    updated: 'Updated',
    deleted: 'Deleted',
    formulaFailed: 'Formula failed',
    required: '{label} is required',
    mustBeYesNo: '{label} must be yes or no',
    mustBeNumber: '{label} must be a number',
    min: '{label} must be at least {min}',
    max: '{label} must be at most {max}',
    maxLength: '{label} must be {max} characters or fewer',
    mustBeDate: '{label} must be a date (YYYY-MM-DD)',
    chooseOption: 'Choose one of the options for {label}',
  },
  hi: {
    saved: 'सहेज लिया गया',
    updated: 'अपडेट किया गया',
    deleted: 'हटा दिया गया',
    formulaFailed: 'गणना नहीं हो सकी',
    required: '{label} भरना ज़रूरी है',
    mustBeYesNo: '{label} हाँ या नहीं होना चाहिए',
    mustBeNumber: '{label} एक संख्या होनी चाहिए',
    min: '{label} कम से कम {min} होना चाहिए',
    max: '{label} ज़्यादा से ज़्यादा {max} होना चाहिए',
    maxLength: '{label} में {max} या उससे कम अक्षर होने चाहिए',
    mustBeDate: '{label} एक तारीख होनी चाहिए (YYYY-MM-DD)',
    chooseOption: '{label} के लिए कोई एक विकल्प चुनें',
  },
  gu: {
    saved: 'સાચવ્યું',
    updated: 'અપડેટ થયું',
    deleted: 'કાઢી નાખ્યું',
    formulaFailed: 'ગણતરી થઈ શકી નહીં',
    required: '{label} ભરવું જરૂરી છે',
    mustBeYesNo: '{label} હા કે ના હોવું જોઈએ',
    mustBeNumber: '{label} સંખ્યા હોવી જોઈએ',
    min: '{label} ઓછામાં ઓછું {min} હોવું જોઈએ',
    max: '{label} વધુમાં વધુ {max} હોવું જોઈએ',
    maxLength: '{label} માં {max} કે તેથી ઓછા અક્ષર હોવા જોઈએ',
    mustBeDate: '{label} તારીખ હોવી જોઈએ (YYYY-MM-DD)',
    chooseOption: '{label} માટે એક વિકલ્પ પસંદ કરો',
  },
  mr: {
    saved: 'जतन केले',
    updated: 'अपडेट केले',
    deleted: 'हटवले',
    formulaFailed: 'गणना झाली नाही',
    required: '{label} भरणे आवश्यक आहे',
    mustBeYesNo: '{label} होय किंवा नाही असावे',
    mustBeNumber: '{label} एक संख्या असावी',
    min: '{label} किमान {min} असावे',
    max: '{label} जास्तीत जास्त {max} असावे',
    maxLength: '{label} मध्ये {max} किंवा त्यापेक्षा कमी अक्षरे असावीत',
    mustBeDate: '{label} एक तारीख असावी (YYYY-MM-DD)',
    chooseOption: '{label} साठी एक पर्याय निवडा',
  },
  bn: {
    saved: 'সংরক্ষিত হয়েছে',
    updated: 'আপডেট হয়েছে',
    deleted: 'মুছে ফেলা হয়েছে',
    formulaFailed: 'হিসাব করা যায়নি',
    required: '{label} দেওয়া আবশ্যক',
    mustBeYesNo: '{label} হ্যাঁ বা না হতে হবে',
    mustBeNumber: '{label} একটি সংখ্যা হতে হবে',
    min: '{label} কমপক্ষে {min} হতে হবে',
    max: '{label} সর্বোচ্চ {max} হতে হবে',
    maxLength: '{label} {max}টি বা তার কম অক্ষরের হতে হবে',
    mustBeDate: '{label} একটি তারিখ হতে হবে (YYYY-MM-DD)',
    chooseOption: '{label}-এর জন্য একটি বিকল্প বেছে নিন',
  },
  ta: {
    saved: 'சேமிக்கப்பட்டது',
    updated: 'புதுப்பிக்கப்பட்டது',
    deleted: 'நீக்கப்பட்டது',
    formulaFailed: 'கணக்கீடு தோல்வியடைந்தது',
    required: '{label} அவசியம்',
    mustBeYesNo: '{label} ஆம் அல்லது இல்லை என இருக்க வேண்டும்',
    mustBeNumber: '{label} ஒரு எண்ணாக இருக்க வேண்டும்',
    min: '{label} குறைந்தது {min} ஆக இருக்க வேண்டும்',
    max: '{label} அதிகபட்சம் {max} ஆக இருக்க வேண்டும்',
    maxLength: '{label} {max} எழுத்துகளுக்குள் இருக்க வேண்டும்',
    mustBeDate: '{label} ஒரு தேதியாக இருக்க வேண்டும் (YYYY-MM-DD)',
    chooseOption: '{label} க்கு ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்',
  },
  te: {
    saved: 'సేవ్ అయింది',
    updated: 'అప్‌డేట్ అయింది',
    deleted: 'తొలగించబడింది',
    formulaFailed: 'లెక్క విఫలమైంది',
    required: '{label} తప్పనిసరి',
    mustBeYesNo: '{label} అవును లేదా కాదు అయి ఉండాలి',
    mustBeNumber: '{label} ఒక సంఖ్య అయి ఉండాలి',
    min: '{label} కనీసం {min} ఉండాలి',
    max: '{label} గరిష్ఠంగా {max} ఉండాలి',
    maxLength: '{label} {max} అక్షరాలకు మించకూడదు',
    mustBeDate: '{label} ఒక తేదీ అయి ఉండాలి (YYYY-MM-DD)',
    chooseOption: '{label} కోసం ఒక ఎంపికను ఎంచుకోండి',
  },
  kn: {
    saved: 'ಉಳಿಸಲಾಗಿದೆ',
    updated: 'ಅಪ್‌ಡೇಟ್ ಮಾಡಲಾಗಿದೆ',
    deleted: 'ಅಳಿಸಲಾಗಿದೆ',
    formulaFailed: 'ಲೆಕ್ಕ ವಿಫಲವಾಯಿತು',
    required: '{label} ಕಡ್ಡಾಯ',
    mustBeYesNo: '{label} ಹೌದು ಅಥವಾ ಇಲ್ಲ ಆಗಿರಬೇಕು',
    mustBeNumber: '{label} ಒಂದು ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು',
    min: '{label} ಕನಿಷ್ಠ {min} ಆಗಿರಬೇಕು',
    max: '{label} ಗರಿಷ್ಠ {max} ಆಗಿರಬೇಕು',
    maxLength: '{label} {max} ಅಕ್ಷರಗಳಿಗಿಂತ ಹೆಚ್ಚಿರಬಾರದು',
    mustBeDate: '{label} ಒಂದು ದಿನಾಂಕವಾಗಿರಬೇಕು (YYYY-MM-DD)',
    chooseOption: '{label} ಗಾಗಿ ಒಂದು ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ',
  },
  ml: {
    saved: 'സേവ് ചെയ്തു',
    updated: 'അപ്ഡേറ്റ് ചെയ്തു',
    deleted: 'ഇല്ലാതാക്കി',
    formulaFailed: 'കണക്കുകൂട്ടൽ പരാജയപ്പെട്ടു',
    required: '{label} നിർബന്ധമാണ്',
    mustBeYesNo: '{label} അതെ അല്ലെങ്കിൽ അല്ല എന്നായിരിക്കണം',
    mustBeNumber: '{label} ഒരു സംഖ്യയായിരിക്കണം',
    min: '{label} കുറഞ്ഞത് {min} ആയിരിക്കണം',
    max: '{label} പരമാവധി {max} ആയിരിക്കണം',
    maxLength: '{label} {max} അക്ഷരങ്ങളിൽ കൂടരുത്',
    mustBeDate: '{label} ഒരു തീയതിയായിരിക്കണം (YYYY-MM-DD)',
    chooseOption: '{label}-ന് ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക',
  },
  pa: {
    saved: 'ਸੰਭਾਲ ਲਿਆ ਗਿਆ',
    updated: 'ਅੱਪਡੇਟ ਕੀਤਾ ਗਿਆ',
    deleted: 'ਮਿਟਾ ਦਿੱਤਾ ਗਿਆ',
    formulaFailed: 'ਹਿਸਾਬ ਨਹੀਂ ਹੋ ਸਕਿਆ',
    required: '{label} ਭਰਨਾ ਜ਼ਰੂਰੀ ਹੈ',
    mustBeYesNo: '{label} ਹਾਂ ਜਾਂ ਨਾਂਹ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ',
    mustBeNumber: '{label} ਇੱਕ ਗਿਣਤੀ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ',
    min: '{label} ਘੱਟੋ-ਘੱਟ {min} ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ',
    max: '{label} ਵੱਧ ਤੋਂ ਵੱਧ {max} ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ',
    maxLength: '{label} ਵਿੱਚ {max} ਜਾਂ ਘੱਟ ਅੱਖਰ ਹੋਣੇ ਚਾਹੀਦੇ ਹਨ',
    mustBeDate: '{label} ਇੱਕ ਤਾਰੀਖ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ (YYYY-MM-DD)',
    chooseOption: '{label} ਲਈ ਇੱਕ ਵਿਕਲਪ ਚੁਣੋ',
  },
};

/**
 * Engine text in the app's language. `lang` is `spec.lang` (any BCP-47 tag, or undefined).
 * Unknown languages and missing keys fall back to English, never to the raw key.
 */
export function engineText(lang: string | null | undefined, key: EngineKey, params?: TranslateParams): string {
  const code = resolveLanguage(lang); // unknown languages become 'en'
  const template = ENGINE_MESSAGES[code][key] ?? ENGINE_MESSAGES.en[key];
  const format = createFormatter(code);
  return interpolate(template, params, { formatNumber: (n) => format.number(n) });
}
