import { createDeliveryClient, DeliveryError } from '@kontent-ai/delivery-sdk';
import { createManagementClient } from '@kontent-ai/management-sdk';
import type { 
  EnvironmentCredentials, 
  UsageMetrics, 
  EnvironmentData, 
  ApiResponse,
  ContentTypeSummary,
  AssetSummary,
  LanguageSummary,
  CollectionSummary,
  UserSummary,
  ProjectSummary
} from './types';

export class KontentApiClient {
  constructor(_credentials: EnvironmentCredentials) {
    // Constructor for future use
  }

  // Test if Delivery API key has Content Preview permission
  private async testContentPreviewAccess(environmentId: string, apiKey?: string): Promise<{ hasAccess: boolean; errorMessage?: string }> {
    if (!apiKey || apiKey.trim() === '') {
      return { hasAccess: false, errorMessage: 'No API key provided' };
    }

    // First, test if the key has basic environment access (using published content)
    try {
      const publishedClient = createDeliveryClient({ 
        environmentId,
        previewApiKey: apiKey,
        secureApiKey: apiKey,
        defaultQueryConfig: {
          usePreviewMode: false
        }
      });
      
      // Test basic environment access with published content
      const publishedQuery = publishedClient.items()
        .limitParameter(1)
        .depthParameter(0)
        .queryConfig({ usePreviewMode: false, useSecuredMode: true });

      await publishedQuery.toPromise();
      console.log('Basic environment access confirmed');
    } catch (error) {
      // If basic access fails, this is an environment access issue
      if (error instanceof DeliveryError) {
        console.log('Environment access test failed:', { errorCode: error.errorCode, specificCode: error.specificCode, message: error.message });
        return { hasAccess: false, errorMessage: 'Invalid Delivery Preview API key. Please verify your key and try again.' };
      }
      console.warn('Unexpected error testing environment access:', error);
      return { hasAccess: false, errorMessage: 'Invalid Delivery Preview API key. Please verify your key and try again.' };
    }

    // If basic access works, now test Content Preview permission
    try {
      const previewClient = createDeliveryClient({ 
        environmentId,
        previewApiKey: apiKey,
        defaultQueryConfig: {
          usePreviewMode: true
        },
        globalHeaders: (_queryConfig: any) => {
          return [
            {
              header: 'X-KC-Wait-For-Loading-New-Content',
              value: 'true'
            }
          ];
        }
      });
      
      // Test preview access by requesting items in preview mode
      const testQuery = previewClient.items()
        .limitParameter(1)
        .depthParameter(0)
        .queryConfig({ usePreviewMode: true });

      await testQuery.toPromise();
      return { hasAccess: true }; // Content Preview permission confirmed
    } catch (error) {
      // If we get here, basic access works but preview doesn't - this is a Content Preview permission issue
      if (error instanceof DeliveryError) {
        console.log('Content Preview test failed (but environment access works):', { errorCode: error.errorCode, specificCode: error.specificCode, message: error.message });
        return { hasAccess: false, errorMessage: "Invalid Delivery Preview API key. Please provide a key with 'Content preview' selected and try again." };
      }
      console.warn('Unexpected error testing Content Preview access:', error);
      return { hasAccess: false, errorMessage: 'Invalid Delivery Preview API key. Please verify your key and try again.' };
    }
  }

  async collectEnvironmentData(environmentId: string, credentials: EnvironmentCredentials): Promise<ApiResponse<EnvironmentData>> {
    try {
      const metrics: UsageMetrics = {
        activeUsers: 0,
        bandwidth: 0,
        collections: 0,
        contentItems: 0,
        contentTypes: 0,
        assetStorageSize: 0,
        assetCount: 0,
        customRoles: 0,
        spaces: 0,
        languages: 0,
        publishedContentItems: 0,
        unpublishedContentItems: 0,
        archivedContentItems: 0,
        workflowSteps: 0,
        averageContentItemsPerType: 0,
        averageAssetsPerItem: 0,
        storageUtilizationPercentage: 0
      };

      const apiKeysAvailable = {
        delivery: !!credentials.deliveryApiKey,
        management: !!credentials.managementApiKey,
        subscription: !!credentials.subscriptionApiKey
      };

      // Collect data from available APIs
      if (credentials.deliveryApiKey) {
        const deliveryData = await this.collectDeliveryData(environmentId, credentials.deliveryApiKey);
        if (deliveryData.success && deliveryData.data) {
          Object.assign(metrics, deliveryData.data);
        }
      }

      if (credentials.managementApiKey) {
        const managementData = await this.collectManagementData(environmentId, credentials.managementApiKey);
        if (managementData.success && managementData.data) {
          Object.assign(metrics, managementData.data);
        }
      }

      // Subscription API: count active non-kontent.ai users in this environment
      if (credentials.subscriptionApiKey && credentials.subscriptionId) {
        try {
          const activeUsers = await this.countActiveSubscriptionUsersForEnvironment(
            credentials.subscriptionId,
            credentials.subscriptionApiKey,
            environmentId
          );
          metrics.activeUsers = activeUsers;
        } catch (e) {
          console.warn('Failed to count subscription users:', e);
        }
      }

      // Calculate derived metrics
      metrics.averageContentItemsPerType = metrics.contentTypes > 0 ? metrics.contentItems / metrics.contentTypes : 0;
      metrics.averageAssetsPerItem = metrics.contentItems > 0 ? metrics.assetCount / metrics.contentItems : 0;

      const environmentData: EnvironmentData = {
        environmentId,
        name: `Environment ${environmentId}`, // Default name: show full environment ID
        metrics,
        lastUpdated: new Date().toISOString(),
        apiKeysAvailable
      };

      return {
        success: true,
        data: environmentData
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async collectDeliveryData(environmentId: string, apiKey: string): Promise<ApiResponse<Partial<UsageMetrics>>> {
    try {
      // Test if API key has Content Preview permission (required for accurate item counting)
      const previewAccessResult = await this.testContentPreviewAccess(environmentId, apiKey);
      
      if (!previewAccessResult.hasAccess) {
        return {
          success: false,
          error: previewAccessResult.errorMessage || "Invalid Delivery Preview API key. Please provide a key with 'Content Preview' enabled and try again."
        };
      }

      // Configure client for preview mode (required for accurate usage metrics)
      const clientConfig: any = {
        environmentId,
        previewApiKey: apiKey,
        defaultQueryConfig: {
          usePreviewMode: true
        },
        globalHeaders: (_queryConfig: any) => {
          return [
            {
              header: 'X-KC-Wait-For-Loading-New-Content',
              value: 'true'
            }
          ];
        }
      };
      
      const client = createDeliveryClient(clientConfig);

      const metrics: Partial<UsageMetrics> = {};

      // Get content types - fallback to manual pagination since includeTotalCount might not be supported
      try {
        let allTypes: any[] = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
          const typesResponse = await client.types()
            .limitParameter(limit)
            .skipParameter(skip)
            .toPromise();

          allTypes = allTypes.concat(typesResponse.data.items);
          hasMore = typesResponse.data.items.length === limit;
          skip += limit;
        }

        metrics.contentTypes = allTypes.length;
      } catch (error) {
        console.warn('Failed to get content types from Delivery API:', error);
        metrics.contentTypes = 0;
      }

      // Get languages - fallback to manual pagination since includeTotalCount might not be supported
      let allLanguages: any[] = [];
      try {
        let skip = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
          const languagesResponse = await client.languages()
            .limitParameter(limit)
            .skipParameter(skip)
            .toPromise();

          allLanguages = allLanguages.concat(languagesResponse.data.items);
          hasMore = languagesResponse.data.items.length === limit;
          skip += limit;
        }

        metrics.languages = allLanguages.length;
      } catch (error) {
        console.warn('Failed to get languages from Delivery API:', error);
        metrics.languages = 0;
      }

      // Get content items (all workflow steps) - count language variants properly
      try {
        let totalContentItems = 0;
        
        // For each language, count content items in that language (using preview mode for all workflow steps)
        for (const language of allLanguages) {
          try {
            const languageItemsResponse = await client.items()
              .limitParameter(1) // Only get 1 item since we just need the count
              .includeTotalCountParameter()
              .languageParameter(language.system.codename)
              .equalsFilter('system.language', language.system.codename)
              .depthParameter(0) // Only get basic info, not full content
              .queryConfig({ usePreviewMode: true }) // Ensure preview mode for all workflow steps
              .toPromise();

            const languageItemCount = languageItemsResponse.data.pagination.totalCount || 0;
            totalContentItems += languageItemCount;
          } catch (langError) {
            console.warn(`Failed to get content items for language ${language.codename}:`, langError);
            // Continue with other languages even if one fails
          }
        }

        metrics.publishedContentItems = totalContentItems;
        metrics.contentItems = totalContentItems; // For delivery API, this counts all workflow steps (language variants)
      } catch (error) {
        console.warn('Failed to get content items from Delivery API:', error);
        metrics.publishedContentItems = 0;
        metrics.contentItems = 0;
      }

      return {
        success: true,
        data: metrics
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to collect delivery data'
      };
    }
  }

  private async collectManagementData(environmentId: string, apiKey: string): Promise<ApiResponse<Partial<UsageMetrics>>> {
    try {
      const client = createManagementClient({
        environmentId,
        apiKey
      });

      const metrics: Partial<UsageMetrics> = {};

      // Get assets and storage size - use toAllPromise to handle pagination
      const assetsResponse = await client.listAssets().toAllPromise();
      metrics.assetCount = assetsResponse.data.items.length;
      let assetSizeTotal = 0;
      for (const asset of assetsResponse.data.items) {
        assetSizeTotal+=asset.size || 0;
      }
      metrics.assetStorageSize = assetsResponse.data.items.reduce((total, asset) => total + (asset.size || 0), 0);

      // Get collections
      try {
        const collectionsResponse = await client.listCollections().toPromise();
        metrics.collections = collectionsResponse.data.collections.length;
      } catch (error) {
        // Collections might not be available in all environments
        metrics.collections = 0;
      }

      // Get custom roles (excluding the default "Project manager" role)
      try {
        const rolesResponse = await client.listRoles().toPromise();
        // Filter out the default "Project manager" role
        const customRoles = rolesResponse.data.roles.filter(role => 
          role.codename !== 'project-manager'
        );
        metrics.customRoles = customRoles.length;
      } catch (error) {
        console.warn('Failed to get custom roles from Management API:', error);
        metrics.customRoles = 0;
      }

      // Get spaces
      try {
        const spacesResponse = await client.listSpaces().toPromise();
        metrics.spaces = spacesResponse.data.length;
      } catch (error) {
        console.warn('Failed to get spaces from Management API:', error);
        metrics.spaces = 0;
      }

      return {
        success: true,
        data: metrics
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to collect management data'
      };
    }
  }

  // Uses Subscription API: GET /{subscription_id}/users with continuation to aggregate users
  private async countActiveSubscriptionUsersForEnvironment(
    subscriptionId: string,
    subscriptionApiKey: string,
    environmentId: string
  ): Promise<number> {
    const baseUrl = `https://manage.kontent.ai/v2/subscriptions/${subscriptionId}/users`;
    let continuation: string | undefined = undefined;
    let total = 0;

    // Loop pages
    // Avoid parallel requests per Subscription API guidance
    // https://kontent.ai/learn/docs/apis/openapi/subscription-api/#operation/list-users-under-a-subscription
    do {
      const res = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${subscriptionApiKey}`,
          ...(continuation ? { 'x-continuation': continuation } : {})
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Subscription API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const users = Array.isArray(data.users) ? data.users : [];

      // Sum users active in the specified environment and not kontent.ai emails
      for (const user of users) {
        const email: string = user.email || '';
        if (email.toLowerCase().endsWith('@kontent.ai')) {
          continue;
        }

        // projects[].environments[] contains environment assignments with is_user_active
        const projects = Array.isArray(user.projects) ? user.projects : [];
        let isActiveInEnv = false;
        for (const proj of projects) {
          const envs = Array.isArray(proj.environments) ? proj.environments : [];
          for (const env of envs) {
            if (env && env.id === environmentId && env.is_user_active === true) {
              isActiveInEnv = true;
              break;
            }
          }
          if (isActiveInEnv) break;
        }

        if (isActiveInEnv) {
          total += 1;
        }
      }

      continuation = data?.pagination?.continuation_token || undefined;
    } while (continuation);

    return total;
  }

  // Test Delivery API key validity
  async testDeliveryApiKey(environmentId: string, apiKey: string): Promise<ApiResponse<boolean>> {
    try {
      const previewAccessResult = await this.testContentPreviewAccess(environmentId, apiKey);
      if (!previewAccessResult.hasAccess) {
        return {
          success: false,
          error: previewAccessResult.errorMessage || "Invalid Delivery Preview API key. Please provide a key with 'Content preview' selected and try again."
        };
      }
      return { success: true, data: true };
    } catch (error: any) {
      console.error('Error testing Delivery API key:', error);
      
      // Extract specific error message from Delivery SDK
      let errorMessage = 'Invalid Delivery Preview API key. Please verify your key and try again.';
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // Test Management API key validity
  async testManagementApiKey(environmentId: string, apiKey: string): Promise<ApiResponse<boolean>> {
    try {
      const client = createManagementClient({
        environmentId,
        apiKey
      });

      // Test with a simple request
      await client.listAssets().toPromise();
      return { success: true, data: true };
    } catch (error: any) {
      console.error('Error testing Management API key:', error);
      
      return {
        success: false,
        error: 'Invalid Management API key. Please verify your key and try again.'
      };
    }
  }

  // Removed getContentItems: Delivery metrics are fully collected in collectDeliveryData

  async getContentTypes(environmentId: string, credentials: EnvironmentCredentials): Promise<ApiResponse<ContentTypeSummary[]>> {
    try {
      if (!credentials.managementApiKey) {
        return {
          success: false,
          error: 'Management API key required for content types'
        };
      }

      const client = createManagementClient({
        environmentId,
        apiKey: credentials.managementApiKey
      });

      const response = await client.listContentTypes().toAllPromise();
      const types: ContentTypeSummary[] = response.data.items.map(type => ({
        id: type.id,
        name: type.name,
        codename: type.codename,
        elements: type.elements.length,
        lastModified: type.lastModified.toISOString()
      }));

      return {
        success: true,
        data: types
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get content types'
      };
    }
  }

  async getAssets(environmentId: string, credentials: EnvironmentCredentials): Promise<ApiResponse<AssetSummary[]>> {
    try {
      if (!credentials.managementApiKey) {
        return {
          success: false,
          error: 'Management API key required for assets'
        };
      }

      const client = createManagementClient({
        environmentId,
        apiKey: credentials.managementApiKey
      });

      const response = await client.listAssets().toAllPromise();
      const assets: AssetSummary[] = response.data.items.map(asset => ({
        id: asset.id,
        fileName: asset.fileName,
        title: asset.title || undefined,
        size: asset.size || 0,
        type: asset.type || 'Unknown',
        url: asset.url,
        lastModified: asset.lastModified.toISOString()
      }));

      return {
        success: true,
        data: assets
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get assets'
      };
    }
  }

  async getLanguages(environmentId: string, credentials: EnvironmentCredentials): Promise<ApiResponse<LanguageSummary[]>> {
    try {
      if (!credentials.managementApiKey) {
        return {
          success: false,
          error: 'Management API key required for languages'
        };
      }

      const client = createManagementClient({
        environmentId,
        apiKey: credentials.managementApiKey
      });

      const response = await client.listLanguages().toPromise();
      const languages: LanguageSummary[] = response.data.items.map(lang => ({
        id: lang.id,
        name: lang.name,
        codename: lang.codename,
        isDefault: lang.isDefault || false,
        isActive: lang.isActive || false
      }));

      return {
        success: true,
        data: languages
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get languages'
      };
    }
  }

  async getCollections(environmentId: string, credentials: EnvironmentCredentials): Promise<ApiResponse<CollectionSummary[]>> {
    try {
      if (!credentials.managementApiKey) {
        return {
          success: false,
          error: 'Management API key required for collections'
        };
      }

      const client = createManagementClient({
        environmentId,
        apiKey: credentials.managementApiKey
      });

      const response = await client.listCollections().toPromise();
      const collections: CollectionSummary[] = response.data.collections.map((collection: any) => ({
        id: collection.id,
        name: collection.name,
        codename: collection.codename,
        lastModified: collection.lastModified.toISOString()
      }));

      return {
        success: true,
        data: collections
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get collections'
      };
    }
  }
}

// Subscription API client using Management SDK
export class SubscriptionApiClient {
  private subscriptionId: string;
  private apiKey: string;
  constructor(subscriptionId: string, apiKey: string) {
    this.subscriptionId = subscriptionId;
    this.apiKey = apiKey;
  }

  // GET /{subscription_id}/projects using Management SDK
  async getProjects(): Promise<ApiResponse<ProjectSummary[]>> {
    try {
      // Create Management client with subscription credentials
      const client = createManagementClient({
        subscriptionId: this.subscriptionId,
        apiKey: this.apiKey
      });

      // Use the Management SDK to list subscription projects
      const response = await client.listSubscriptionProjects().toAllPromise();

      
      const projects: ProjectSummary[] = response.data.items.map((project: any) => ({
        id: project.id,
        name: project.name,
        environments: project.environments.map((env: any) => ({ 
          id: env.id, 
          name: env.name 
        }))
      }));

      return { success: true, data: projects };
    } catch (error: any) {
      console.error('Error listing projects:', error);
      
      // Extract status code from Management SDK error
      let statusCode = 0;
      let errorMessage = 'Failed to load projects. Please verify your credentials and try again.';
      
      // Check for specific error messages first (most reliable for Management SDK)
      if (error?.message === 'Missing or invalid API key. Please include a valid API key in the Authorization header, using the following format: \'Authorization: Bearer <YOUR_API_KEY>\'.') {
        statusCode = 401;
        errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
      } else if (error?.response?.status) {
        statusCode = error.response.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message || error.response.statusText}`;
        }
      } else if (error?.status) {
        statusCode = error.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message}`;
        }
      } else if (error?.code === 'ERR_NETWORK' && error?.message === 'Network Error') {
        // Fallback for Network Error (likely 400)
        statusCode = 400;
        errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to load projects. Please verify your credentials and try again.';
      }

      return { 
        success: false, 
        error: { 
          status: statusCode,
          message: errorMessage
        } 
      };
    }
  }

  async getUsers(): Promise<ApiResponse<UserSummary[]>> {
    try {
      // Create Management client with subscription credentials
      const client = createManagementClient({
        subscriptionId: this.subscriptionId,
        apiKey: this.apiKey
      });

      // Use the Management SDK to list subscription users
      const response = await client.listSubscriptionUsers().toAllPromise();
      
      const users: UserSummary[] = response.data.items.map((user: any) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        roles: user.roles || [],
        isActive: user.isActive || false,
        lastLogin: user.lastLogin || undefined
      }));

      return { success: true, data: users };
    } catch (error: any) {
      console.error('Error listing users:', error);
      
      // Extract status code from Management SDK error
      let statusCode = 0;
      let errorMessage = 'Failed to load users. Please verify your credentials and try again.';
      
      // Check for specific error messages first (most reliable for Management SDK)
      if (error?.message === 'Missing or invalid API key. Please include a valid API key in the Authorization header, using the following format: \'Authorization: Bearer <YOUR_API_KEY>\'.') {
        statusCode = 401;
        errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
      } else if (error?.response?.status) {
        statusCode = error.response.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message || error.response.statusText}`;
        }
      } else if (error?.status) {
        statusCode = error.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message}`;
        }
      } else if (error?.code === 'ERR_NETWORK' && error?.message === 'Network Error') {
        // Fallback for Network Error (likely 400)
        statusCode = 400;
        errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to load users. Please verify your credentials and try again.';
      }

      return { 
        success: false, 
        error: { 
          status: statusCode,
          message: errorMessage
        } 
      };
    }
  }

  // Test Subscription API key validity
  async testSubscriptionApiKey(): Promise<ApiResponse<boolean>> {
    try {
      // Create Management client with subscription credentials
      const client = createManagementClient({
        subscriptionId: this.subscriptionId,
        apiKey: this.apiKey
      });

      // Test with a simple request
      await client.listSubscriptionProjects().toPromise();
      return { success: true, data: true };
    } catch (error: any) {
      // Extract status code from Management SDK error
      let statusCode = 0;
      let errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
      
      // Check for specific error messages first (most reliable for Management SDK)
      if (error?.message === 'Missing or invalid API key. Please include a valid API key in the Authorization header, using the following format: \'Authorization: Bearer <YOUR_API_KEY>\'.') {
        statusCode = 401;
        errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
      } else if (error?.response?.status) {
        statusCode = error.response.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message || error.response.statusText}`;
        }
      } else if (error?.status) {
        statusCode = error.status;
        switch (statusCode) {
          case 400:
            errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
            break;
          case 401:
            errorMessage = 'Invalid Subscription API key. Please verify your key and try again.';
            break;
          case 403:
            errorMessage = 'Insufficient permissions. Please verify your API key permissions and try again.';
            break;
          case 404:
            errorMessage = 'Subscription not found. Please verify your Subscription ID and try again.';
            break;
          default:
            errorMessage = `Subscription API error ${statusCode}: ${error.message}`;
        }
      } else if (error?.code === 'ERR_NETWORK' && error?.message === 'Network Error') {
        // Fallback for Network Error (likely 400)
        statusCode = 400;
        errorMessage = 'Invalid Subscription ID. Please verify your Subscription ID and try again.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Invalid Subscription API key. Please verify your key and try again.';
      }

      return { 
        success: false, 
        error: errorMessage
      };
    }
  }
}
