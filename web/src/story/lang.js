// Which story and which language. The default run is the short one
// (design.md 18b/18c) with Norwegian on screen; ?story=full is the three-act
// version, in English. ?lang=en or ?lang=no picks the language for either.
// Voiced lines stay English in both.
const q = new URLSearchParams(location.search);
export const FULL = q.get('story') === 'full';
export const LANG = q.get('lang') === 'en' || q.get('lang') === 'no' ? q.get('lang') : (FULL ? 'en' : 'no');
// T('Norsk', 'English'): the text for the current language
export const T = (no, en) => (LANG === 'en' ? en : no);
