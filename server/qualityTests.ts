import { detectProfanity } from "./profanityDetector";
import { detectLanguagePolicyViolations } from "./languagePolicyDetector";
import { analyzeParticipationBalance } from "./participationAnalyzer";
import { analyzeTopicAdherence } from "./topicAdherenceDetector";
import type { TranscriptSegment } from "@shared/schema";
import { qualityLogger } from "./qualityLogger";

export interface QualityTestResult {
  testName: string;
  passed: boolean;
  details: any;
  transcriptId?: string;
}

/**
 * Quality validation tests to ensure system correctness
 * These tests help identify false positives/negatives and ensure alerts are useful
 */

/**
 * Test 1: Profanity Detection Accuracy
 * Validates that profanity detection correctly identifies inappropriate language
 * and doesn't produce excessive false positives
 */
export async function testProfanityDetection(
  segments: TranscriptSegment[],
  transcriptId: string
): Promise<QualityTestResult> {
  const detection = detectProfanity(segments, transcriptId);
  
  // Check for false positives: common words that might be flagged incorrectly
  const falsePositiveWords = ['class', 'pass', 'assess', 'analysis'];
  const hasFalsePositives = detection.flaggedItems.some(item =>
    falsePositiveWords.some(fp => item.flaggedWord.toLowerCase().includes(fp))
  );

  // Check for reasonable detection rate (not too many flags per segment)
  const flagsPerSegment = segments.length > 0 ? detection.flaggedItems.length / segments.length : 0;
  const isSpammy = flagsPerSegment > 0.5; // More than 1 flag per 2 segments is suspicious

  const passed = !hasFalsePositives && !isSpammy;

  const result: QualityTestResult = {
    testName: 'profanity_detection_accuracy',
    passed,
    details: {
      totalFlags: detection.flaggedItems.length,
      flagsPerSegment,
      hasFalsePositives,
      isSpammy,
      flaggedWords: detection.flaggedItems.map(f => f.flaggedWord),
    },
    transcriptId,
  };

  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }

  return result;
}

/**
 * Test 2: Language Policy Detection
 * Validates that language policy violations are correctly identified
 */
export async function testLanguagePolicyDetection(
  segments: TranscriptSegment[],
  transcriptId: string,
  allowedLanguage: string = 'en'
): Promise<QualityTestResult> {
  const detection = detectLanguagePolicyViolations(segments, transcriptId, allowedLanguage);
  
  // Check if violations are reasonable (not flagging English as non-English)
  const hasEnglishFalsePositives = detection.violations.some(v =>
    v.flaggedWord.toLowerCase() === 'english' || v.flaggedWord.toLowerCase() === 'en'
  );

  const passed = !hasEnglishFalsePositives;

  const result: QualityTestResult = {
    testName: 'language_policy_detection',
    passed,
    details: {
      totalViolations: detection.violations.length,
      detectedLanguages: Array.from(new Set(detection.violations.map(v => v.flaggedWord))).sort(),
      hasEnglishFalsePositives,
    },
    transcriptId,
  };

  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }

  return result;
}

/**
 * Test 3: Participation Balance Reasonableness
 * Validates that participation balance analysis produces useful signals
 * and doesn't flag balanced discussions incorrectly
 */
export async function testParticipationBalance(
  segments: TranscriptSegment[],
  transcriptId: string
): Promise<QualityTestResult> {
  const analysis = analyzeParticipationBalance(segments);
  
  // Check if analysis is reasonable:
  // - For 3-6 speakers, no single speaker should dominate (>50%)
  // - At least 2 speakers should have meaningful participation (>10%)
  const speakerCount = analysis.speakers.length;
  const meaningfulSpeakers = analysis.speakers.filter(s => s.percentage > 0.1).length;
  
  // For classroom groups (3-6 students), expect at least 2 active speakers
  const isReasonable = speakerCount >= 2 && meaningfulSpeakers >= 2;
  const hasUnreasonableDominance = analysis.dominantSpeaker && 
    (analysis.speakers.find(s => s.speakerId === analysis.dominantSpeaker)?.percentage || 0) > 0.7; // >70% is very dominant

  const passed = isReasonable && !hasUnreasonableDominance;

  const result: QualityTestResult = {
    testName: 'participation_balance_reasonableness',
    passed,
    details: {
      speakerCount,
      meaningfulSpeakers,
      isBalanced: analysis.isBalanced,
      dominantSpeaker: analysis.dominantSpeaker,
      silentSpeakers: analysis.silentSpeakers,
      hasUnreasonableDominance,
    },
    transcriptId,
  };

  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }

  return result;
}

/**
 * Test 4: Alert Spam Prevention
 * Validates that alerts are not too frequent/spammy for teachers
 */
export async function testAlertSpamPrevention(
  allFlaggedItems: any[],
  transcriptId: string,
  durationSeconds: number
): Promise<QualityTestResult> {
  // Calculate alert rate
  const alertsPerMinute = durationSeconds > 0 ? (allFlaggedItems.length / durationSeconds) * 60 : 0;
  
  // Threshold: more than 5 alerts per minute is considered spammy
  const isSpammy = alertsPerMinute > 5;
  
  // Check alert diversity (not all same type)
  const alertTypes = new Set(allFlaggedItems.map(item => item.flagType || 'profanity'));
  const hasDiversity = alertTypes.size > 1 || allFlaggedItems.length < 3; // OK if few alerts or diverse types

  const passed = !isSpammy && hasDiversity;

  const result: QualityTestResult = {
    testName: 'alert_spam_prevention',
    passed,
    details: {
      totalAlerts: allFlaggedItems.length,
      alertsPerMinute: alertsPerMinute.toFixed(2),
      durationSeconds,
      isSpammy,
      alertTypes: Array.from(alertTypes),
      hasDiversity,
    },
    transcriptId,
  };

  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }

  return result;
}

/**
 * Run all quality tests on a transcript
 */
export async function runAllQualityTests(
  segments: TranscriptSegment[],
  transcriptId: string,
  allFlaggedItems: any[],
  durationSeconds: number,
  allowedLanguage: string = 'en'
): Promise<QualityTestResult[]> {
  const results = await Promise.all([
    testProfanityDetection(segments, transcriptId),
    testLanguagePolicyDetection(segments, transcriptId, allowedLanguage),
    testParticipationBalance(segments, transcriptId),
    testAlertSpamPrevention(allFlaggedItems, transcriptId, durationSeconds),
  ]);

  // Log summary
  const passedCount = results.filter(r => r.passed).length;
  const totalTests = results.length;
  
  await qualityLogger.logQualityMetric(transcriptId, 'quality_tests_summary', {
    passedCount,
    totalTests,
    allPassed: passedCount === totalTests,
    results: results.map(r => ({ testName: r.testName, passed: r.passed })),
  });

  return results;
}

