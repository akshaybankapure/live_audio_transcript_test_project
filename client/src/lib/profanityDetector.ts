/**
 * Advanced frontend profanity detector with fuzzy matching
 * Handles leet speak, variations, and live streaming detection
 */

/** CONFIG: profanity dictionary (expand as needed) */
const PROFANITY = new Set([
  "fuck", "fucks", "fucked", "fucking", "motherfucker", "mf", "hell", "hells", "what the fuck", "what the hell", "what the shit", "what the ass", "what the dick", "what the cock", "what the pussy", "what the shit", "what the ass", "what the dick", "what the cock", "what the pussy",
  "shit", "shitty", "bullshit", "wtf", "tf", "stfu", "gtfo",
  "ass", "asshole", "dumbass", "jackass",
  "bitch", "bitches", "bastard",
  "dick", "dicks", "dickhead",
  "cock", "cocks", "cocksucker",
  "pussy", "slut", "whore",
  "crap", "damn", "dammit",
  "suck my dick", "go to hell", "screw you",
  "fuk", "f*ck", "f**k", "fu", "f u", "fukn", "fkn", "fkin", "fking",
  "sht", "sh*t", "sh**", "af", "pussy", 
  //add few hindi ones here
  
  // Test words for demonstration
  "good afternoon", "goodafternoon", "afternoon",
  "good morning", "goodmorning", "morning",
  "good evening", "goodevening", "evening",
  "good night", "goodnight", "night",
  "goodbye", "bye",
  "hello", "hi",
  "thanks", "thank you",
  "please", "plz",
  "sorry", "sry",
  "private"
]);

/** whitelist avoids classic false-positives */
const WHITELIST = new Set(["assess", "classic", "passion", "scunthorpe"]);

/** Leet mapping */
const LEET_MAP: Record<string, string> = {
  "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "|": "i",
  "0": "o", "5": "s", "$": "s", "7": "t", "8": "b"
};

/** Zero-width chars */
const ZERO_WIDTH_RE = /[\u200B-\u200F\uFEFF]/g;

/** Normalize text */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .toLowerCase();
}

/** Collapse "loooool" → "lool" */
function collapseRepeats(s: string, maxRun: number = 2): string {
  return s.replace(/(.)\1{2,}/g, (m, ch) => ch.repeat(maxRun));
}

/** Leet unmask: f*ck, f@ck → fuck */
function leetUnmask(s: string): string {
  return s.replace(/./g, ch => LEET_MAP[ch] || ch);
}

/** Strip punctuation (keep letters/digits) */
function stripPunct(s: string): string {
  return s.replace(/[^a-z0-9\s]/g, "");
}

/** Basic Damerau-Levenshtein */
function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length, lenB = b.length;
  if (!lenA) return lenB;
  if (!lenB) return lenA;

  const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
  for (let i = 0; i <= lenA; i++) dp[i][0] = i;
  for (let j = 0; j <= lenB; j++) dp[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // delete
        dp[i][j - 1] + 1,      // insert
        dp[i - 1][j - 1] + cost // substitute
      );

      // transpose
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[lenA][lenB];
}

/** Compute fuzzy similarity score */
function fuzzyScore(token: string, prof: string): number {
  if (token === prof) return 1.0;

  const tokenStripped = stripPunct(leetUnmask(token));
  const profNorm = stripPunct(prof);

  if (tokenStripped === profNorm) return 0.98;

  const d = damerauLevenshtein(tokenStripped, profNorm);
  const maxLen = Math.max(tokenStripped.length, profNorm.length);
  const score = 1 - d / maxLen;
  return Math.max(0, score);
}

/** Score a candidate word/phrase */
function scoreCandidate(text: string): { score: number; match: string | null } {
  let norm = normalize(text);
  norm = collapseRepeats(norm);
  const letters = stripPunct(leetUnmask(norm));

  for (const w of Array.from(WHITELIST)) {
    if (norm.includes(w)) return { score: 0, match: null };
  }

  let best = { score: 0, match: null as string | null };

  for (const prof of Array.from(PROFANITY)) {
    const profNorm = normalize(prof);
    if (profNorm.includes(" ")) {
      if (norm.includes(profNorm)) return { score: 1.0, match: prof };
    }

    const s = fuzzyScore(letters, profNorm);
    if (s > best.score) best = { score: s, match: prof };
    if (best.score >= 0.98) break;
  }

  return best;
}

export interface ProfanityMatch {
  word: string;
  index: number;
  length: number;
  score: number;
  match: string | null;
}

/**
 * Detect profanity in text using fuzzy matching
 * Returns array of matches with positions
 */
export function detectProfanity(text: string): ProfanityMatch[] {
  const matches: ProfanityMatch[] = [];
  const words = text.split(/\s+/);
  
  words.forEach((word, wordIndex) => {
    // Find word boundaries in original text
    const wordStart = text.indexOf(word, wordIndex > 0 ? text.indexOf(words[wordIndex - 1]) + words[wordIndex - 1].length : 0);
    
    if (wordStart === -1) return;
    
    const { score, match } = scoreCandidate(word);
    const threshold = word.length <= 6 ? 0.95 : 0.85;
    
    if (score >= threshold && match) {
      matches.push({
        word,
        index: wordStart,
        length: word.length,
        score,
        match,
      });
    }
  });
  
  return matches;
}

/**
 * Check if text contains profanity
 */
export function hasProfanity(text: string): boolean {
  const words = text.split(/\s+/);
  for (const word of words) {
    const { score, match } = scoreCandidate(word);
    const threshold = word.length <= 6 ? 0.95 : 0.85;
    if (score >= threshold && match) {
      return true;
    }
  }
  return false;
}

/**
 * Highlight profanity in text by wrapping matches in spans
 * Returns JSX-ready array of text parts with highlighted profanity
 */
export function highlightProfanity(text: string): Array<{ text: string; isProfanity: boolean; score?: number }> {
  const matches = detectProfanity(text);
  
  if (matches.length === 0) {
    return [{ text, isProfanity: false }];
  }
  
  // Sort matches by index (ascending)
  const sortedMatches = [...matches].sort((a, b) => a.index - b.index);
  
  const parts: Array<{ text: string; isProfanity: boolean; score?: number }> = [];
  let lastIndex = 0;
  
  for (const match of sortedMatches) {
    // Add text before profanity
    if (match.index > lastIndex) {
      parts.push({
        text: text.substring(lastIndex, match.index),
        isProfanity: false,
      });
    }
    
    // Add profanity word
    parts.push({
      text: text.substring(match.index, match.index + match.length),
      isProfanity: true,
      score: match.score,
    });
    
    lastIndex = match.index + match.length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.substring(lastIndex),
      isProfanity: false,
    });
  }
  
  return parts;
}

/**
 * Detect non-English words in text (for language policy highlighting)
 * Uses Unicode ranges to identify different scripts
 */
function isNonEnglishWord(word: string, allowedLanguage: string = 'en'): boolean {
  if (allowedLanguage.toLowerCase() !== 'en') {
    // If allowed language is not English, we'd need to check against that language
    // For now, we'll focus on English-only detection
    return false;
  }

  // Remove punctuation and whitespace
  const cleanWord = word.trim().replace(/[^\w]/g, '');
  if (cleanWord.length === 0) return false;

  // Check if word contains non-ASCII characters (likely non-English)
  // This includes: Devanagari (Hindi), Arabic, Chinese, Japanese, Korean, etc.
  const nonEnglishRegex = /[\u0080-\uFFFF]/;
  
  // Also check for common non-English scripts
  const devanagariRegex = /[\u0900-\u097F]/; // Hindi, Sanskrit, etc.
  const arabicRegex = /[\u0600-\u06FF]/; // Arabic
  const chineseRegex = /[\u4E00-\u9FFF]/; // Chinese
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/; // Hiragana, Katakana
  const koreanRegex = /[\uAC00-\uD7AF]/; // Korean
  
  return nonEnglishRegex.test(cleanWord) && 
         (devanagariRegex.test(cleanWord) || 
          arabicRegex.test(cleanWord) || 
          chineseRegex.test(cleanWord) || 
          japaneseRegex.test(cleanWord) || 
          koreanRegex.test(cleanWord));
}

/**
 * Highlight language policy violations in text
 * Returns array of text parts with non-allowed language words highlighted
 */
export function highlightLanguagePolicyViolations(
  text: string, 
  segmentLanguage: string | undefined,
  allowedLanguage: string = 'en'
): Array<{ text: string; isLanguageViolation: boolean }> {
  // If segment language matches allowed language, no highlighting needed
  if (!segmentLanguage || segmentLanguage.toLowerCase() === allowedLanguage.toLowerCase()) {
    return [{ text, isLanguageViolation: false }];
  }

  // For mixed-language segments, highlight non-English portions
  // Split by Unicode script boundaries to identify language changes
  const parts: Array<{ text: string; isLanguageViolation: boolean }> = [];
  let currentPart = '';
  let currentIsViolation = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isNonEnglishChar = /[\u0080-\uFFFF]/.test(char) && 
      (/[\u0900-\u097F]/.test(char) || // Devanagari
       /[\u0600-\u06FF]/.test(char) || // Arabic
       /[\u4E00-\u9FFF]/.test(char) || // Chinese
       /[\u3040-\u309F\u30A0-\u30FF]/.test(char) || // Japanese
       /[\uAC00-\uD7AF]/.test(char)); // Korean
    
    if (isNonEnglishChar !== currentIsViolation && currentPart.length > 0) {
      // Language boundary detected - save current part and start new one
      parts.push({
        text: currentPart,
        isLanguageViolation: currentIsViolation,
      });
      currentPart = char;
      currentIsViolation = isNonEnglishChar;
    } else {
      currentPart += char;
      if (currentPart.length === 1) {
        currentIsViolation = isNonEnglishChar;
      }
    }
  }
  
  // Add final part
  if (currentPart.length > 0) {
    parts.push({
      text: currentPart,
      isLanguageViolation: currentIsViolation,
    });
  }

  // If no violations found, return original text
  if (parts.every(p => !p.isLanguageViolation)) {
    return [{ text, isLanguageViolation: false }];
  }

  return parts;
}

/**
 * Live streaming detector (typing / ASR)
 */
export class LiveProfanityDetector {
  private windowSize: number;
  private tokens: string[];

  constructor(windowSize: number = 8) {
    this.windowSize = windowSize;
    this.tokens = [];
  }

  ingest(chunk: string): Array<{ phrase: string; match: string; score: number; severity: 'high' | 'medium' }> {
    const newTokens = chunk.split(/(\s+)/);
    const detections: Array<{ phrase: string; match: string; score: number; severity: 'high' | 'medium' }> = [];

    for (const t of newTokens) {
      if (t.trim() !== "") this.tokens.push(t);
      if (this.tokens.length > this.windowSize) this.tokens.shift();

      const active = this.tokens.filter(x => x.trim() !== "");

      for (let L = 1; L <= active.length; L++) {
        const phrase = active.slice(-L).join(" ");
        const { score, match } = scoreCandidate(phrase);

        const threshold = phrase.length <= 6 ? 0.95 : 0.85;

        if (score >= threshold && match) {
          detections.push({
            phrase,
            match,
            score,
            severity: score >= 0.95 ? "high" : "medium"
          });
          break;
        }
      }
    }

    return detections;
  }

  reset(): void {
    this.tokens = [];
  }
}
