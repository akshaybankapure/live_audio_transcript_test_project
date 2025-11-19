import { AlertTriangle, Languages, UserX, MessageSquareX, Flag } from "lucide-react";
import type { FlaggedContent } from "@shared/schema";

export type FlagType = 'profanity' | 'language_policy' | 'participation' | 'off_topic';

export interface FlagConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  icon: typeof AlertTriangle;
  variant: 'destructive' | 'outline';
  criticality: 'high' | 'low' | 'none';
}

export const FLAG_CONFIGS: Record<FlagType, FlagConfig> = {
  profanity: {
    label: 'Profanity',
    color: 'destructive',
    bgColor: 'bg-red-50 dark:bg-red-950/20',
    borderColor: 'border-red-500/30 dark:border-red-500/50',
    textColor: 'text-red-700 dark:text-red-300',
    icon: AlertTriangle,
    variant: 'destructive',
    criticality: 'high',
  },
  language_policy: {
    label: 'Language Policy',
    color: 'orange',
    bgColor: 'bg-orange-50 dark:bg-orange-950/20',
    borderColor: 'border-orange-500/30 dark:border-orange-500/50',
    textColor: 'text-orange-700 dark:text-orange-300',
    icon: Languages,
    variant: 'outline',
    criticality: 'low',
  },
  participation: {
    label: 'Participation',
    color: 'blue',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    borderColor: 'border-blue-500/30 dark:border-blue-500/50',
    textColor: 'text-blue-700 dark:text-blue-300',
    icon: UserX,
    variant: 'outline',
    criticality: 'low',
  },
  off_topic: {
    label: 'Off-Topic',
    color: 'yellow',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
    borderColor: 'border-yellow-500/30 dark:border-yellow-500/50',
    textColor: 'text-yellow-700 dark:text-yellow-300',
    icon: MessageSquareX,
    variant: 'outline',
    criticality: 'none', // Not critical unless outside acceptable range
  },
};

export function getFlagConfig(flagType: FlagType | string): FlagConfig {
  return FLAG_CONFIGS[flagType as FlagType] || {
    label: 'Flag',
    color: 'gray',
    bgColor: 'bg-gray-50 dark:bg-gray-950/20',
    borderColor: 'border-gray-500/30 dark:border-gray-500/50',
    textColor: 'text-gray-700 dark:text-gray-300',
    icon: Flag,
    variant: 'outline',
    criticality: 'none',
  };
}

export function getFlagBadgeClassName(flagType: FlagType | string): string {
  const config = getFlagConfig(flagType);
  
  if (config.variant === 'destructive') {
    return 'text-xs';
  }
  
  // For outline variants, use custom colors
  const colorMap: Record<string, string> = {
    orange: 'border-orange-500 text-orange-700 bg-orange-50 dark:border-orange-500/50 dark:text-orange-300 dark:bg-orange-950/20',
    blue: 'border-blue-500 text-blue-700 bg-blue-50 dark:border-blue-500/50 dark:text-blue-300 dark:bg-blue-950/20',
    yellow: 'border-yellow-500 text-yellow-700 bg-yellow-50 dark:border-yellow-500/50 dark:text-yellow-300 dark:bg-yellow-950/20',
  };
  
  return `text-xs ${colorMap[config.color] || ''}`;
}

export function getFlagIconClassName(flagType: FlagType | string): string {
  const config = getFlagConfig(flagType);
  
  const colorMap: Record<string, string> = {
    destructive: 'text-destructive',
    orange: 'text-orange-600 dark:text-orange-400',
    blue: 'text-blue-600 dark:text-blue-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
  };
  
  return `h-3.5 w-3.5 ${colorMap[config.color] || 'text-muted-foreground'}`;
}

