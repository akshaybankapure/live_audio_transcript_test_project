import { db } from "./db";
import { qualityLogs } from "@shared/schema";

export type LogType = 'detection_decision' | 'quality_metric' | 'alert_triggered' | 'test_result';

export interface QualityLogMetadata {
  [key: string]: any;
}

/**
 * Logs quality and observability data for analysis
 * Helps track:
 * - Why alerts were triggered
 * - Model/heuristic decisions
 * - Quality metrics per group
 * - Test results
 */
export class QualityLogger {
  /**
   * Log a detection decision (e.g., why profanity was flagged)
   */
  async logDetectionDecision(
    transcriptId: string,
    decisionType: string,
    metadata: QualityLogMetadata
  ): Promise<void> {
    try {
      await db.insert(qualityLogs).values({
        transcriptId,
        logType: 'detection_decision',
        metadata: {
          decisionType,
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[QualityLogger] Failed to log detection decision:', error);
      // Don't throw - logging failures shouldn't break the app
    }
  }

  /**
   * Log quality metrics (e.g., participation balance, topic adherence)
   */
  async logQualityMetric(
    transcriptId: string,
    metricName: string,
    metricValue: any,
    additionalMetadata?: QualityLogMetadata
  ): Promise<void> {
    try {
      await db.insert(qualityLogs).values({
        transcriptId,
        logType: 'quality_metric',
        metadata: {
          metricName,
          metricValue,
          ...additionalMetadata,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[QualityLogger] Failed to log quality metric:', error);
    }
  }

  /**
   * Log when an alert is triggered
   */
  async logAlertTriggered(
    transcriptId: string,
    alertType: string,
    alertData: QualityLogMetadata
  ): Promise<void> {
    try {
      await db.insert(qualityLogs).values({
        transcriptId,
        logType: 'alert_triggered',
        metadata: {
          alertType,
          ...alertData,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[QualityLogger] Failed to log alert:', error);
    }
  }

  /**
   * Log test results for quality validation
   */
  async logTestResult(
    transcriptId: string,
    testName: string,
    passed: boolean,
    details?: QualityLogMetadata
  ): Promise<void> {
    try {
      await db.insert(qualityLogs).values({
        transcriptId,
        logType: 'test_result',
        metadata: {
          testName,
          passed,
          ...details,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[QualityLogger] Failed to log test result:', error);
    }
  }
}

export const qualityLogger = new QualityLogger();

