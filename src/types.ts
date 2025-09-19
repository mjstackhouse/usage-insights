// Data models for Kontent.ai Usage Insights Tool

export interface EnvironmentCredentials {
  environmentId: string;
  deliveryApiKey?: string;
  managementApiKey?: string;
  subscriptionApiKey?: string;
  subscriptionId?: string;
}

export interface SubscriptionCredentials {
  subscriptionId: string;
  subscriptionApiKey: string;
}

export interface UsageMetrics {
  // Core metrics from Kontent.ai usage report
  activeUsers: number;
  bandwidth: number; // Estimated from API calls
  collections: number;
  contentItems: number; // All languages/variants
  contentTypes: number;
  assetStorageSize: number; // In bytes
  assetCount: number;
  customRoles: number;
  spaces: number;
  
  // Additional detailed metrics
  languages: number;
  publishedContentItems: number;
  unpublishedContentItems: number;
  archivedContentItems: number;
  workflowSteps: number;
  
  // Calculated metrics
  averageContentItemsPerType: number;
  averageAssetsPerItem: number;
  storageUtilizationPercentage: number;
}

export interface EnvironmentData {
  environmentId: string;
  name: string;
  projectId?: string;
  metrics: UsageMetrics;
  lastUpdated: string;
  apiKeysAvailable: {
    delivery: boolean;
    management: boolean;
    subscription: boolean;
  };
}

export interface SubscriptionData {
  subscriptionId: string;
  name: string;
  environments: EnvironmentData[];
  totalMetrics: UsageMetrics;
  lastUpdated: string;
}

export interface AppState {
  mode: 'single' | 'subscription';
  credentials: {
    subscription?: SubscriptionCredentials;
    environments: EnvironmentCredentials[];
  };
  data: {
    environments: EnvironmentData[];
    subscription?: SubscriptionData;
  };
  ui: {
    currentStep: 'mode-selection' | 'credentials' | 'data-collection' | 'results';
    loadingStates: Record<string, boolean>;
    errors: Record<string, string>;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string | { status: number; message: string };
  errorCode?: number;
}

export interface ContentItemSummary {
  id: string;
  name: string;
  codename: string;
  type: string;
  language: string;
  workflowStep: string;
  lastModified: string;
  isPublished: boolean;
}

export interface ContentTypeSummary {
  id: string;
  name: string;
  codename: string;
  elements: number;
  lastModified: string;
}

export interface AssetSummary {
  id: string;
  fileName: string;
  title?: string;
  size: number;
  type: string;
  url: string;
  lastModified: string;
}

export interface LanguageSummary {
  id: string;
  name: string;
  codename: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface CollectionSummary {
  id: string;
  name: string;
  codename: string;
  lastModified: string;
}

export interface UserSummary {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  isActive: boolean;
  lastLogin?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  environments: {
    id: string;
    name: string;
    isProduction: boolean;
  }[];
}

export interface ExportOptions {
  format: 'excel' | 'pdf' | 'json' | 'csv';
  includeDetails: boolean;
  environments: string[];
  metrics: string[];
}
