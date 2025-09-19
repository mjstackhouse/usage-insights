import { useEffect, useState, useRef, useLayoutEffect, type ChangeEvent, type FormEvent } from 'react'
import { AssetModels, createManagementClient, LanguageModels, ManagementClient } from '@kontent-ai/management-sdk';
import './App.css'
import Select from 'react-select';
import * as XLSX from 'xlsx';
import type { 
  AppState, 
  EnvironmentCredentials, 
  EnvironmentData
} from './types';
import { KontentApiClient, SubscriptionApiClient } from './api-clients';

let customAppSDK: any = null;

function App() {
  // Main app state
  const [appState, setAppState] = useState<AppState>({
    mode: 'single',
    credentials: {
      environments: []
    },
    data: {
      environments: []
    },
    ui: {
      currentStep: 'mode-selection',
      loadingStates: {},
      errors: {}
    }
  });

  // Legacy state for backward compatibility (will be removed)
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [environmentIdInputValue, setEnvironmentIdInputValue] = useState<string>('');
  const [languages, setLanguages] = useState<Array<LanguageModels.LanguageModel>>();
  const [assets, setAssets] = useState<Array<AssetModels.Asset>>();
  const [filteredAssets, setFilteredAssets] = useState<Array<AssetModels.Asset>>();
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [initialTableHeight, setInitialTableHeight] = useState<number | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isHandleSubmitLoadingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState<string>('Fetching assets...');
  const [apiKeyErrorText, setApiKeyErrorText] = useState<string>('');
  const [environmentIdErrorText, setEnvironmentIdErrorText] = useState<string>('');
  const [isExportOverviewLoading, setIsExportOverviewLoading] = useState(false);
  const [isExportAssetsLoading, setIsExportAssetsLoading] = useState(false);
  const [pageBeforeSearch, setPageBeforeSearch] = useState<number>(1);
  const [sdkResponse, setSdkResponse] = useState<any>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [apiKeyInvalid, setApiKeyInvalid] = useState(false);
  const [apiKeyErrorFromConfig, setApiKeyErrorFromConfig] = useState(false);

  // New state for usage insights
  const [subscriptionId, setSubscriptionId] = useState<string>('');
  const [subscriptionApiKey, setSubscriptionApiKey] = useState<string>('');
  const [environmentCredentials, setEnvironmentCredentials] = useState<EnvironmentCredentials[]>([]);
  const [isCollectingData, setIsCollectingData] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState<Record<string, string>>({});
  const [projectEnvMap, setProjectEnvMap] = useState<Record<string, { project: string; projectId: string; envName: string }>>({});
  const [subscriptionIdErrorText, setSubscriptionIdErrorText] = useState<string>('');
  const [subscriptionApiKeyErrorText, setSubscriptionApiKeyErrorText] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [apiKeyValidationErrors, setApiKeyValidationErrors] = useState<Record<string, string>>({});
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // New functions for usage insights
  const handleModeSelection = (mode: 'single' | 'subscription') => {
    setAppState(prev => ({
      ...prev,
      mode,
      ui: {
        ...prev.ui,
        currentStep: 'credentials'
      }
    }));

    // Ensure at least one environment is present in single mode
    if (mode === 'single') {
      setEnvironmentCredentials(prev => {
        // If SDK context is available, use that environment ID
        if (sdkResponse?.context?.environmentId) {
          const envId = sdkResponse.context.environmentId;
          const exists = prev.some(c => c.environmentId === envId);
          if (exists) return prev;
          return [...prev, { environmentId: envId, deliveryApiKey: '', managementApiKey: '', subscriptionApiKey: '', subscriptionId: '' }];
        }
        // If no SDK context or no environments exist, add an empty one
        if (prev.length === 0) {
          return [{ environmentId: '', deliveryApiKey: '', managementApiKey: '', subscriptionApiKey: '', subscriptionId: '' }];
        }
        return prev;
      });
    }
  };

  const addEnvironmentCredential = () => {
    const newCredential: EnvironmentCredentials = {
      environmentId: '',
      deliveryApiKey: '',
      managementApiKey: '',
      subscriptionApiKey: '',
      subscriptionId: ''
    };
    setEnvironmentCredentials(prev => [...prev, newCredential]);
    // Clear validation errors when adding environment
    setValidationErrors([]);
    setApiKeyValidationErrors({});
    
    // Hide all API key error elements
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      (element as HTMLElement).style.display = 'none';
    });
  };

  const updateEnvironmentCredential = (index: number, field: keyof EnvironmentCredentials, value: string) => {
    setEnvironmentCredentials(prev => 
      prev.map((cred, i) => 
        i === index ? { ...cred, [field]: value } : cred
      )
    );
    // Clear validation errors when user makes changes
    setValidationErrors([]);
    // Clear API key validation errors for this specific field
    setApiKeyValidationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`env-${index}-${field.replace('ApiKey', '').replace('Id', '')}`];
      return newErrors;
    });
    
    // Hide the error element for this field
    const errorElement = document.getElementById(`api-key-error-env-${index}-${field.replace('ApiKey', '').replace('Id', '')}`) as HTMLElement;
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  };

  const removeEnvironmentCredential = (index: number) => {
    setEnvironmentCredentials(prev => prev.filter((_, i) => i !== index));
    // Clear validation errors when removing environment
    setValidationErrors([]);
    setApiKeyValidationErrors({});
    
    // Hide all API key error elements
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      (element as HTMLElement).style.display = 'none';
    });
  };

  // Apply the current environment's keys to all environments within the same project (subscription analysis helper)
  const applyKeysToSameProject = (index: number) => {
    const source = environmentCredentials[index];
    if (!source || !source.environmentId) return;
    const projectId = projectEnvMap[source.environmentId]?.projectId;
    if (!projectId) return;

    setEnvironmentCredentials(prev => prev.map((cred) => {
      const belongsToSameProject = projectEnvMap[cred.environmentId]?.projectId === projectId;
      if (!belongsToSameProject) return cred;
      return {
        ...cred,
        deliveryApiKey: source.deliveryApiKey || '',
        managementApiKey: source.managementApiKey || '',
        subscriptionApiKey: source.subscriptionApiKey || '',
        subscriptionId: source.subscriptionId || cred.subscriptionId || ''
      };
    }));
  };

  // Validate that all environments have at least one API key
  const validateEnvironmentCredentials = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    environmentCredentials.forEach((cred, index) => {
      if (!cred.environmentId.trim()) {
        errors.push(`Environment ${index + 1}: Environment ID is required`);
        return;
      }
      
      const hasAnyKey = cred.deliveryApiKey?.trim() || 
                       cred.managementApiKey?.trim() || 
                       cred.subscriptionApiKey?.trim();
      
      if (!hasAnyKey) {
        errors.push(`Environment ${index + 1}: At least one API key is required (Delivery, Management, or Subscription)`);
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // Test API key validity before data collection
  const testApiKeyValidity = async (): Promise<{ isValid: boolean; errors: Record<string, string> }> => {
    const errors: Record<string, string> = {};
    
    for (let i = 0; i < environmentCredentials.length; i++) {
      const cred = environmentCredentials[i];
      if (!cred.environmentId.trim()) continue;
      
      // Test Delivery API key if provided
      if (cred.deliveryApiKey?.trim()) {
        try {
          const client = new KontentApiClient(cred);
          const testResult = await client.testDeliveryApiKey(cred.environmentId, cred.deliveryApiKey);
          if (!testResult.success) {
            errors[`env-${i}-delivery`] = typeof testResult.error === 'string' ? testResult.error : 'Invalid Delivery API key';
          }
        } catch (error) {
          errors[`env-${i}-delivery`] = 'Failed to test Delivery API key';
        }
      }
      
      // Test Management API key if provided
      if (cred.managementApiKey?.trim()) {
        try {
          const client = new KontentApiClient(cred);
          const testResult = await client.testManagementApiKey(cred.environmentId, cred.managementApiKey);
          if (!testResult.success) {
            errors[`env-${i}-management`] = typeof testResult.error === 'string' ? testResult.error : 'Invalid Management API key';
          }
        } catch (error) {
          errors[`env-${i}-management`] = 'Failed to test Management API key';
        }
      }
      
      // Test Subscription API key if provided
      if (cred.subscriptionApiKey?.trim() && cred.subscriptionId?.trim()) {
        try {
          const subClient = new SubscriptionApiClient(cred.subscriptionId, cred.subscriptionApiKey);
          const testResult = await subClient.testSubscriptionApiKey();
          if (!testResult.success) {
            errors[`env-${i}-subscription`] = typeof testResult.error === 'string' ? testResult.error : 'Invalid Subscription API key';
          }
        } catch (error) {
          errors[`env-${i}-subscription`] = 'Failed to test Subscription API key';
        }
      }
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  };

  // Check if the form is valid for enabling/disabling the collect button
  const isFormValid = (): boolean => {
    return validateEnvironmentCredentials().isValid;
  };

  const collectUsageData = async () => {
    // Validate credentials before proceeding
    const validation = validateEnvironmentCredentials();
    setValidationErrors(validation.errors);
    
    if (!validation.isValid) {
      return;
    }

    // Test API key validity before proceeding
    setIsCollectingData(true);
    setApiKeyValidationErrors({});
    
    // Hide all API key error elements before testing
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      (element as HTMLElement).style.display = 'none';
    });
    
    const apiKeyValidation = await testApiKeyValidity();
    setApiKeyValidationErrors(apiKeyValidation.errors);
    
    if (!apiKeyValidation.isValid) {
      // Show error elements for invalid API keys
      Object.keys(apiKeyValidation.errors).forEach(errorKey => {
        const errorElement = document.getElementById(`api-key-error-${errorKey}`) as HTMLElement;
        if (errorElement) {
          errorElement.style.display = 'block';
        }
      });
      setIsCollectingData(false);
      return;
    }

    setCollectionProgress({});
    
    const environments: EnvironmentData[] = [];
    
    try {
      for (let i = 0; i < environmentCredentials.length; i++) {
        const cred = environmentCredentials[i];
        if (!cred.environmentId) continue;
        
        setCollectionProgress(prev => ({
          ...prev,
          [cred.environmentId]: 'Collecting data...'
        }));
        
        const client = new KontentApiClient(cred);
        const result = await client.collectEnvironmentData(cred.environmentId, cred);
        
        if (result.success && result.data) {
          environments.push(result.data);
          setCollectionProgress(prev => ({
            ...prev,
            [cred.environmentId]: 'Completed'
          }));
        } else {
          setCollectionProgress(prev => ({
            ...prev,
            [cred.environmentId]: `Error: ${result.error}`
          }));
        }
      }
      
      setAppState(prev => ({
        ...prev,
        data: {
          ...prev.data,
          environments
        },
        ui: {
          ...prev.ui,
          currentStep: 'results'
        }
      }));

      // Scroll to top after successful data collection
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
      window.scrollTo({ top: 0, behavior: scrollBehavior });
    } catch (error) {
      console.error('Error collecting data:', error);
    } finally {
      setIsCollectingData(false);
    }
  };

  const exportUsageReport = (format: 'excel' | 'json' | 'csv') => {
    const { environments } = appState.data;
    if (!environments.length) return;

    if (format === 'excel') {
      exportUsageToExcel(environments);
    } else if (format === 'json') {
      exportUsageToJson(environments);
    } else if (format === 'csv') {
      exportUsageToCsv(environments);
    }
  };

  const exportUsageToExcel = (environments: EnvironmentData[]) => {
    const wsData = [
      ['Environment ID', 'Name', 'Content Items', 'Content Types', 'Languages', 'Assets', 'Storage Size (MB)', 'Collections', 'Custom Roles', 'Spaces', 'Active Users', 'Last Updated'],
      ...environments.map(env => [
        env.environmentId,
        env.name,
        env.metrics.contentItems,
        env.metrics.contentTypes,
        env.metrics.languages,
        env.metrics.assetCount,
        Math.round(env.metrics.assetStorageSize / 1024 / 1024 * 100) / 100,
        env.metrics.collections,
        env.metrics.customRoles,
        env.metrics.spaces,
        env.metrics.activeUsers,
        new Date(env.lastUpdated).toLocaleDateString()
      ])
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Usage Report');
    XLSX.writeFile(wb, `kontent-usage-report-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportUsageToJson = (environments: EnvironmentData[]) => {
    const data = {
      generatedAt: new Date().toISOString(),
      environments: environments.map(env => ({
        ...env,
        metrics: {
          ...env.metrics,
          assetStorageSizeMB: Math.round(env.metrics.assetStorageSize / 1024 / 1024 * 100) / 100
        }
      }))
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kontent-usage-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportUsageToCsv = (environments: EnvironmentData[]) => {
    const csvData = [
      'Environment ID,Name,Content Items,Content Types,Languages,Assets,Storage Size (MB),Collections,Custom Roles,Spaces,Active Users,Last Updated',
      ...environments.map(env => 
        `${env.environmentId},${env.name},${env.metrics.contentItems},${env.metrics.contentTypes},${env.metrics.languages},${env.metrics.assetCount},${Math.round(env.metrics.assetStorageSize / 1024 / 1024 * 100) / 100},${env.metrics.collections},${env.metrics.customRoles},${env.metrics.spaces},${env.metrics.activeUsers},${new Date(env.lastUpdated).toLocaleDateString()}`
      )
    ].join('\n');
    
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kontent-usage-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper function to format metric values based on API key availability
  const formatMetricValue = (value: number, apiKeyRequired: string, hasApiKey: boolean) => {
    if (hasApiKey) {
      return value.toString();
    }
    return (
      <span 
        className="text-gray-400 italic cursor-help" 
        title={`Requires ${apiKeyRequired}`}
      >
        Unavailable
      </span>
    );
  };

  // Legacy functions (keeping for backward compatibility)
  function exportOverviewToExcel(overviewData: any[], totalAssets?: number, fullyDescribed?: number) {
    if (!overviewData || overviewData.length === 0) return;
    const wsData = [
      [
        'Total assets:', totalAssets ?? overviewData[0]?.total ?? 0
      ],
      [
        'Described in all selected languages:', fullyDescribed ?? overviewData[0]?.fullyDescribed ?? 0
      ],
      [], // Empty row for spacing
      [
        'Language',
        'Percentage with Description',
        'Number with Description',
        'Default Language',
      ],
      ...overviewData.map((lang: any) => [
        lang.name,
        `${lang.percent}%`,
        `${lang.withDescription}`,
        lang.isDefault ? 'Yes' : 'No',
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Overview');
    XLSX.writeFile(wb, `${environmentId}-overview.xlsx`);
  }
  
  // Helper to export asset table data to Excel
  function exportAssetsToExcel({
    assets,
    languages,
    selectedLanguages,
    environmentId
  }: {
    assets: AssetModels.Asset[];
    languages: LanguageModels.LanguageModel[];
    selectedLanguages: string[];
    environmentId: string;
  }) {
    if (!assets || assets.length === 0) return;
    const langHeaders = languages.filter((lang: LanguageModels.LanguageModel) => selectedLanguages.includes(lang.id));
    const wsData = [
      [
        'Edit Link',
        'Title',
        ...langHeaders.map((lang: LanguageModels.LanguageModel) => lang.name)
      ],
      ...assets.map((asset: AssetModels.Asset) => [
        `https://app.kontent.ai/${environmentId}/content-inventory/assets/asset/${asset.id}`,
        asset.title && asset.title.trim() !== '' ? asset.title : asset.fileName,
        ...langHeaders.map((lang: LanguageModels.LanguageModel) => {
          const desc = asset.descriptions.find((d: any) => d.language.id === lang.id);
          return desc && desc.description ? desc.description : 'None';
        })
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');
    XLSX.writeFile(wb, `${environmentId}-assets.xlsx`);
  }
  
  // Helper: check if asset is an image
  function isImageAsset(asset: any) {
    return asset.type && asset.type.startsWith('image/');
  }

  // Add this function to handle Kontent.ai API errors (now inside App)
  function handleApiError(error: any, sdkRes?: any) {
    // Try to extract error code/message from Kontent.ai API error response
    let errorCode = error?.response?.data?.error || error?.code || error.errorCode;
    let message = error?.response?.data?.message || error?.message || 'An error occurred.';

    if (typeof errorCode === 'number') {
      const apiKeyError = document.getElementById('api-key-error');
      
      // Check if this is a custom app with API key in config
      if (sdkRes && sdkRes.config?.managementApiKey && sdkRes.config.managementApiKey.trim() !== '') {
        // API key was provided in config but is invalid
        setApiKeyErrorFromConfig(true);
        setApiKeyInvalid(false); // Don't show manual input
        setApiKeyErrorText('Invalid or unauthorized API key. Please check your API key and its permissions.');
        if (apiKeyError) apiKeyError.style.display = 'block';
      }
      else {
        // Regular API key error for manual input
        
        
        if (apiKeyError) {
          setApiKeyErrorText('Invalid or unauthorized API key. Please check your API key and its permissions.');
          apiKeyError.style.display = 'block';
          // apiKeyError.innerText = 'Invalid or unauthorized API key. Please check your API key and its permissions.';
        }
        
        setApiKeyInvalid(true);
        setApiKeyErrorFromConfig(false);
      }
    }

    const environmentIdError = document.getElementById('environment-id-error');

    if (error === 'no assets') {
      if (environmentIdError) {
        setEnvironmentIdErrorText('Your environment contains no assets. Please choose a different environment.');
        environmentIdError.style.display = 'block';
        // environmentIdError.innerText = 'Your environment contains no assets. Please choose a different environment.';
      }
    }

    if (errorCode === 400 || errorCode === 403 || errorCode === 404 || message === 'Network Error') {
      if (environmentIdError) {
        setEnvironmentIdErrorText('Invalid environment ID. Please check your environment ID.');
        environmentIdError.style.display = 'block';
        // environmentIdError.innerText = 'Invalid environment ID. Please check your environment ID.';
      }
    }
  }

  async function handleSubmit(event?: FormEvent, sdkRes?: any) {
    if (event) event.preventDefault();

    setIsLoading(true);
    setLoadingText('Fetching assets...');
    isHandleSubmitLoadingRef.current = true;

    const loadingContainer = document.getElementById('loading-container') as HTMLElement;
    if (loadingContainer) loadingContainer.style.display = 'flex';

    const keyInput = document.getElementById('api-key') as HTMLInputElement;
    const apiKeyError = document.getElementById('api-key-error') as HTMLElement;
    const environmentIdError = document.getElementById('environment-id-error') as HTMLElement;

    let client: ManagementClient | null = null;
    let envId: string = '';
    let apiKey: string = '';
    
    // Handle environment ID - SDK takes priority, fallback to manual input
    if (sdkRes && sdkRes.context?.environmentId) {
      envId = sdkRes.context.environmentId;
      setEnvironmentId(envId);
    } 
    else if (environmentIdInputValue.trim() !== '') {
      envId = environmentIdInputValue;
      setEnvironmentId(envId);
    }
    
    // Handle API key - SDK takes priority, fallback to manual input
    if (sdkRes && sdkRes.config?.managementApiKey && sdkRes.config.managementApiKey.trim() !== '') {
      apiKey = sdkRes.config.managementApiKey;
    } 
    else if (keyInput && keyInput.value.trim() !== '') {
      apiKey = keyInput.value;
    }
    // Validate inputs
    if (!envId) {
      if (loadingContainer) loadingContainer.style.display = 'none';
      if (environmentIdError) environmentIdError.style.display = 'block';
      setEnvironmentIdErrorText('Please provide an environment ID.');
      setIsLoading(false);
    }
    else {
      if (environmentIdError) environmentIdError.style.display = 'none';
    }

    if (!apiKey) {
      if (loadingContainer) loadingContainer.style.display = 'none';
      if (apiKeyError) apiKeyError.style.display = 'block';
      setApiKeyErrorText('Please provide an API key.');
      setIsLoading(false);
    }
    else {
      if (apiKeyError) apiKeyError.style.display = 'none';
    }

    if (envId && apiKey) {
      client = createManagementClient({
        environmentId: envId,
        apiKey: apiKey
      });
    }

    if (client !== null) {
      client
        .listAssets()
        .toAllPromise()
        .then((assetsResponse) => {
          if (assetsResponse.data.items.length > 0) {
            setLoadingText('Fetching languages...');
            client.listLanguages()
              .toPromise()
              .then((langResponse) => {
                if (langResponse.data.items.length > 0) {
                  if (loadingContainer) loadingContainer.style.display = 'none';
                  if (apiKeyError) apiKeyError.style.display = 'none';
                  if (environmentIdError) environmentIdError.style.display = 'none';

                  const activeLanguages = langResponse.data.items.filter((lang) => lang.isActive === true);
                  const map: Record<string, string> = {};
                  
                  activeLanguages.map((lang) => {
                    map[lang.id] = lang.name;
                  })

                  let pages = 0;

                  for (let i = 0; i < assetsResponse.data.items.length; i += 10) {
                    pages++;
                  }

                  setLanguages(activeLanguages);
                  setAssets(assetsResponse.data.items);
                  setFilteredAssets(assetsResponse.data.items);
                  setSelectedLanguages(activeLanguages.map(lang => lang.id));
                  setIsLoading(false);
                  isHandleSubmitLoadingRef.current = false;
                  setApiKeyInvalid(false); // Reset invalid state on success
                  setApiKeyErrorFromConfig(false); // Reset config error state on success
                }
              })
              .catch((error) => {
                // Error handling for Languages endpoint
                if (loadingContainer) loadingContainer.style.display = 'none';
                handleApiError(error, sdkRes);
                setIsLoading(false);
                isHandleSubmitLoadingRef.current = false;
              });
          } 
          else {
            if (loadingContainer) loadingContainer.style.display = 'none';
            handleApiError('no assets', sdkRes);
            setIsLoading(false);
            isHandleSubmitLoadingRef.current = false;
          }
        })
                  .catch((error) => {
            console.log('error in assets: ', error);
            // Error handling for Assets endpoint
            if (loadingContainer) loadingContainer.style.display = 'none';
            handleApiError(error, sdkRes);
            setIsLoading(false);
            isHandleSubmitLoadingRef.current = false;
          });
    }
  }

  function handleShowOnlyMissing(e: ChangeEvent<HTMLInputElement>) {
    setShowOnlyMissing(e.target.checked);
  }

  async function getContext() {
    let response: any;

    if (customAppSDK !== null) {
      response = await customAppSDK.getCustomAppContext();

      if (await response.isError) {
        console.error({ errorCode: response.code, description: response.description});
        setSdkLoaded(true); // Still mark as loaded even if there's an error
      } 
      else {
        if (response.context.environmentId) {
          setEnvironmentId(response.context.environmentId);
          // Auto-add current environment to Single Environment analysis list
          setEnvironmentCredentials(prev => {
            const exists = prev.some(c => c.environmentId === response.context.environmentId);
            if (exists) return prev;
            if (appState.mode !== 'single') return prev; // only for Single Environment flow
            
            // If we have an empty environment, replace it with the SDK environment
            if (prev.length === 1 && prev[0].environmentId === '') {
              return [{
                environmentId: response.context.environmentId,
                deliveryApiKey: '',
                managementApiKey: '',
                subscriptionApiKey: '',
                subscriptionId: ''
              }];
            }
            
            // Otherwise, add a new environment
            const newCred: EnvironmentCredentials = {
              environmentId: response.context.environmentId,
              deliveryApiKey: '',
              managementApiKey: '',
              subscriptionApiKey: '',
              subscriptionId: ''
            };
            return [...prev, newCred];
          });
        }

        setSdkResponse({...response});
        setSdkLoaded(true);

        // Only auto-submit if both environment ID and API key are available
        // AND we're not already loading (to avoid conflicts with manual form submission)
        if (response.context.environmentId && response.config?.managementApiKey && response.config.managementApiKey.trim() !== '' && !isLoading) {
          handleSubmit(undefined, response);
        }
      }
    } else {
      // If SDK is not available, still mark as loaded
      setSdkLoaded(true);
    }
  };

  useEffect(() => {
    async function loadSDK() {
      const loadingContainer = document.getElementById('loading-container') as HTMLElement;

      if (window.self !== window.top) {
        // Show loading immediately for custom app contexts to prevent flash
        if (loadingContainer && !isHandleSubmitLoadingRef.current) {
          setLoadingText('Checking for custom app context...');
          loadingContainer.style.display = 'flex';
        }
        
        try {
          customAppSDK = await import('@kontent-ai/custom-app-sdk');
          if (customAppSDK !== null) {
            await getContext();
          }
        }
        catch (error) {
          console.error(error);
        }
        
        // Hide loading when done
        if (loadingContainer && !isHandleSubmitLoadingRef.current) {
          loadingContainer.style.display = 'none';
        }
      }
      else {
        if (loadingContainer && !isHandleSubmitLoadingRef.current) {
          loadingContainer.style.display = 'none';
        }
        console.log('Running outside of Kontent.ai, SDK not loaded');
      }
      
      // Mark SDK as loaded regardless of outcome
      setSdkLoaded(true);
    }

    loadSDK();
  }, []);

  // Debounce the search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300); // 300ms debounce for responsive UX
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Track the initial table height before searching
  useLayoutEffect(() => {
    if (tableContainerRef.current && !searchQuery && initialTableHeight === null) {
      setInitialTableHeight(tableContainerRef.current.offsetHeight);
    }
    // Optionally, update the height if the table grows (e.g., after clearing search)
    if (tableContainerRef.current && !searchQuery && initialTableHeight !== null) {
      if (tableContainerRef.current.offsetHeight > initialTableHeight) {
        setInitialTableHeight(tableContainerRef.current.offsetHeight);
      }
    }
  }, [searchQuery, filteredAssets, debouncedQuery]);

  // Filter assets by search query (title or file name) using debouncedQuery
  const searchFilteredAssets = filteredAssets
    ? filteredAssets.filter(asset => {
        // Use the same logic as the table display: title if available, otherwise file name
        const displayTitle = asset.title && asset.title.trim() !== '' ? asset.title : asset.fileName;
        // Check all descriptions for a match
        const descriptions = Array.isArray(asset.descriptions)
          ? asset.descriptions.map((d: any) => d.description || '').join(' ') : '';
        const query = debouncedQuery.toLowerCase();
        return (
          displayTitle.toLowerCase().includes(query) ||
          descriptions.toLowerCase().includes(query)
        );
      })
    : [];

  // Filter by language and missing descriptions
  const filteredAssetsByLanguage = searchFilteredAssets
    ? searchFilteredAssets.filter(asset => {
        if (!showOnlyMissing) return true;
        return selectedLanguages.some(langId => {
          const desc = asset.descriptions.find((d: any) => d.language.id === langId);
          return !desc || !desc.description;
        });
      })
    : [];

  const paginatedAssets = filteredAssetsByLanguage.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const computedPageCount = Math.ceil(filteredAssetsByLanguage.length / pageSize);

  // Track when search starts and manage page restoration
  useEffect(() => {
    if (debouncedQuery && debouncedQuery.trim() !== '') {
      // Search is active - store current page and reset to page 1
      setPageBeforeSearch(currentPage);
      setCurrentPage(1);
    } else if (debouncedQuery === '' && pageBeforeSearch !== 1) {
      // Search was cleared - restore the page user was on before searching
      setCurrentPage(pageBeforeSearch);
    } else if (debouncedQuery === '') {
      // Search was cleared but no previous page to restore, or user was already on page 1
      setCurrentPage(1);
    }
  }, [debouncedQuery]);

  // Auto-scroll to left when search returns no results
  useEffect(() => {
    const tableContainer = tableContainerRef.current;
    if (!tableContainer) return;

    // If there are no results and the user is scrolled horizontally, scroll back to left
    if (paginatedAssets.length === 0 && tableContainer.scrollLeft > 0) {
      tableContainer.scrollTo({
        left: 0,
        behavior: 'auto'
      });
    }
  }, [paginatedAssets]);

  // Reset page when languages or missing filter changes
  useEffect(() => {
    setCurrentPage(1);
    setPageBeforeSearch(1);
  }, [selectedLanguages, showOnlyMissing]);

  // Select all and unselect all handlers
  function handleSelectAllLanguages() {
    if (languages) {
      setSelectedLanguages(languages.map(lang => lang.id));
    }
  }

  function handleBackBtn() {
    // Keep environment ID for standalone apps, clear it for custom apps
    if (window.self === window.top) {
      // Standalone mode - keep environment ID, clear API key
      setEnvironmentIdInputValue(environmentId); // Set the input value via React state
    } else {
      // Custom app mode - clear environment ID (will be reloaded from SDK)
      setEnvironmentId('');
      setEnvironmentIdInputValue('');
    }
    
    setLanguages([]);
    setAssets([]);
    setFilteredAssets([]);
    setSelectedLanguages([]);
    setShowOnlyMissing(false);
    setCurrentPage(1);
    setPageBeforeSearch(1);
    setSearchQuery('');
    setDebouncedQuery('');
    setInitialTableHeight(null);
    setIsLoading(false);
    setLoadingText('Fetching assets...');
    setApiKeyErrorText('');
    setEnvironmentIdErrorText('');
    setIsExportOverviewLoading(false);
    setIsExportAssetsLoading(false);
    setSdkLoaded(false);
    setApiKeyInvalid(false); // Reset invalid state when changing settings
    setApiKeyErrorFromConfig(false); // Reset config error state when changing settings
    
    // Don't reset sdkResponse - SDK context should persist
    // The getContext() call below will refresh it if needed
    
    // Re-load SDK context if running in Kontent.ai custom app
    if (window.self !== window.top && customAppSDK !== null) {
      getContext();
    } else {
      // For standalone apps, mark SDK as loaded immediately
      setSdkLoaded(true);
    }
  }

  // Calculate overview metrics for selected languages
  const overviewData = (languages && filteredAssets)
    ? languages
        .filter(lang => selectedLanguages.includes(lang.id))
        .map(lang => {
          const total = filteredAssets.length;
          const withDescription = filteredAssets.filter(asset => {
            const desc = asset.descriptions.find((d: any) => d.language.id === lang.id);
            return desc && desc.description && desc.description.trim() !== '';
          }).length;
          const percent = total > 0 ? Math.round((withDescription / total) * 100) : 0;
          // Fully described: assets that have a description in ALL selected languages
          const fullyDescribed = filteredAssets.filter(asset =>
            selectedLanguages.every(selLangId => {
              const desc = asset.descriptions.find((d: any) => d.language.id === selLangId);
              return desc && desc.description && desc.description.trim() !== '';
            })
          ).length;
          return {
            id: lang.id,
            name: lang.name,
            percent,
            withDescription,
            total,
            fullyDescribed,
            isDefault: lang.isDefault || false
          };
        })
        // Sort by withDescription descending
        .sort((a, b) => b.withDescription - a.withDescription)
  : [];

  function handleExportOverview() {
    setIsExportOverviewLoading(true);
    exportOverviewToExcel(overviewData, filteredAssets?.length ?? 0, overviewData[0]?.fullyDescribed ?? 0);
    setTimeout(() => setIsExportOverviewLoading(false), 1000);
  }

  function handleExportAssets() {
    setIsExportAssetsLoading(true);
    exportAssetsToExcel({
      assets: filteredAssetsByLanguage,
      languages: languages || [],
      selectedLanguages,
      environmentId
    });
    setTimeout(() => setIsExportAssetsLoading(false), 1000);
  }

  useEffect(() => {
    const summary = document.getElementById('assets-summary');
    if (summary) {
      // Check for reduced motion preference for better accessibility
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
      
      summary.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
    }
    
    // Also scroll the table container back to the top when page changes
    const tableContainer = tableContainerRef.current;
    if (tableContainer) {
      // Check for reduced motion preference for better accessibility
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
      
      tableContainer.scrollTo({ top: 0, behavior: scrollBehavior });
    }
  }, [currentPage]);

  // Handle wheel events to prevent accidental table scrolling
  useEffect(() => {
    const tableContainer = tableContainerRef.current;
    if (!tableContainer) return;

    const handleWheel = (e: WheelEvent) => {
      // Only allow table scrolling if the user is explicitly trying to scroll the table
      // or if the table content is actually scrollable
      const isTableScrollable = tableContainer.scrollHeight > tableContainer.clientHeight;
      const isScrollingDown = e.deltaY > 0;
      const isScrollingUp = e.deltaY < 0;
      
      const isAtTop = tableContainer.scrollTop === 0;
      const isAtBottom = tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight;
      
      // Allow table scrolling if:
      // 1. Table is not scrollable (no need to prevent anything)
      // 2. User is scrolling down and not at bottom, or scrolling up and not at top
      // 3. User is scrolling horizontally (deltaX)
      if (!isTableScrollable || 
          (isScrollingDown && !isAtBottom) || 
          (isScrollingUp && !isAtTop) ||
          Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return; // Allow the table scroll
      }
      
      // When at boundaries, don't prevent the scroll - let it bubble up to the page
      // This allows the page to scroll when the user hits the table boundaries
      return; // Let the scroll event bubble up naturally
    };

    tableContainer.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      tableContainer.removeEventListener('wheel', handleWheel);
    };
  }, [paginatedAssets, languages, selectedLanguages]);

  // Distribute row heights evenly when there are fewer than pageSize results
  useEffect(() => {
    const tableContainer = tableContainerRef.current;
    if (!tableContainer || paginatedAssets.length >= pageSize) return;

    const table = tableContainer.querySelector('table');
    if (!table) return;

    // Measure the actual header height dynamically
    const thead = table.querySelector('thead');
    const actualHeaderHeight = thead ? thead.offsetHeight : 60;
    
    // Calculate available height more precisely
    const availableHeight = tableContainer.clientHeight - actualHeaderHeight;
    const rowHeight = Math.max(availableHeight / paginatedAssets.length, 80); // Minimum 80px per row

    // Set equal height on all table rows
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      (row as HTMLElement).style.height = `${rowHeight}px`;
    });

    // Cleanup function to reset heights when component unmounts or dependencies change
    return () => {
      rows.forEach(row => {
        (row as HTMLElement).style.height = '';
      });
    };
  }, [paginatedAssets, pageSize]);

    return (
    <>
      {sdkLoaded && (
        <p id='app-title' className='absolute top-0 right-0 left-0 py-4 pl-[3rem] text-left text-white z-10'>
          Usage Insights
        </p>
      )}

      {/* New Usage Insights UI */}
      {appState.ui.currentStep === 'mode-selection' && (
        <div className='basis-full flex flex-wrap place-content-start'>
          <div className='basis-full mb-6'>
            {/* <h1 className='text-2xl font-bold mb-4'>Usage Insights</h1> */}
            <p className='text-gray-600'>
              Analyze your Kontent.ai usage metrics across environments. Choose your analysis mode:
            </p>
          </div>
          
          <div className='basis-full grid grid-cols-1 md:grid-cols-2 gap-6'>
            <div 
              className='rounded-lg p-6 cursor-pointer transition-colors'
              style={{ backgroundColor: 'rgb(243, 243, 243)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'}
              onClick={() => handleModeSelection('single')}
            >
              <h3 className='text-lg font-semibold mb-2'>Single environment</h3>
              <p className='text-gray-600 mb-4'>
                Analyze usage metrics for individually-added environments. Requires at least one API key to retrieve any metrics.
              </p>
              <div className='text-sm text-gray-500'>
                <strong>Required:</strong> Environment ID<br/>
                <strong>Optional:</strong> Delivery Preview API Key, Management API Key, Subscription ID + Subscription API Key<br/>
                {/* <strong>Optional:</strong> Management API Key<br/> */}
                {/* <strong>Optional:</strong> Subscription ID + Subscription API Key<br/> */}
              </div>
            </div>
            
            <div 
              className='rounded-lg p-6 cursor-pointer transition-colors'
              style={{ backgroundColor: 'rgb(243, 243, 243)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'}
              onClick={() => handleModeSelection('subscription')}
            >
              <h3 className='text-lg font-semibold mb-2'>All environments</h3>
              <p className='text-gray-600 mb-4'>
                Analyze usage metrics across all environments in your subscription. Requires Subscription API access.
              </p>
              <div className='text-sm text-gray-500'>
                <strong>Required:</strong> Subscription ID + Subscription API Key<br/>
                <strong>Optional:</strong> Delivery Preview API Keys, Management API Keys
              </div>
            </div>
          </div>
        </div>
      )}

      {appState.ui.currentStep === 'credentials' && (
        <div className="basis-full">
          <div className='basis-full'>
            <h2 className='text-xl font-bold mb-2'>
              {appState.mode === 'single' ? 'Single environment analysis' : 'Subscription analysis'}
            </h2>
            <p className='text-gray-600 mb-4'>
              {appState.mode === 'single' 
                ? 'Enter your environment credentials to analyze usage metrics.'
                : 'Enter your subscription credentials and environment API keys.'
              }
            </p>
          </div>

          {appState.mode === 'single' && (
            <details className='mb-12'>
              <summary className='text-sm font-semibold text-left cursor-pointer bg-[rgb(243,243,243)]'>
                About metrics and keys
              </summary>
              <div className='rounded-b-lg px-4 pb-4 pt-2 text-left bg-[rgb(243,243,243)]'>
                <ul className='list-disc pl-5 space-y-1 text-sm text-gray-700'>
                  <li>
                    <span className='font-medium'>Delivery API key</span>: Used for Delivery API requests. Provides counts for
                    content items, content types, and languages.
                  </li>
                  <li>
                    <span className='font-medium'>Management API key</span>: Used for Management API requests. Provides
                    asset metrics (asset count and total storage size) and collections.
                  </li>
                  <li>
                    <span className='font-medium'>Subscription API key + Subscription ID</span>: Used for Subscription API
                    requests. Provides active user counts per environment and loads
                    projects/environments in Subscription Analysis mode.
                  </li>
                </ul>
              </div>
            </details>
          )}

          {appState.mode === 'subscription' && (
            <div className='basis-full mb-12'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 stack-inputs'>
                <div className='relative'>
                  <label className='block text-sm font-medium mb-2'>Subscription ID</label>
                  <input
                    type='text'
                    value={subscriptionId}
                    onChange={(e) => setSubscriptionId(e.target.value)}
                    className='w-full px-3 py-2 border border-gray-300 rounded-md'
                    placeholder='Enter subscription ID'
                  />
                  <p id='subscription-id-error' className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10 left-[100px] text-xs'>
                    {subscriptionIdErrorText}
                  </p>
                </div>
                <div className='relative'>
                  <label className='block text-sm font-medium mb-2'>Subscription API Key</label>
                  <input
                    type='password'
                    value={subscriptionApiKey}
                    onChange={(e) => setSubscriptionApiKey(e.target.value)}
                    className='w-full px-3 py-2 border border-gray-300 rounded-md'
                    placeholder='Enter subscription API key'
                  />
                  <p id='subscription-api-key-error' className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10 left-[150px] text-xs'>
                    {subscriptionApiKeyErrorText}
                  </p>
                </div>
              </div>
              <div className='mt-4 flex justify-end'>
                <button
                  onClick={async () => {
                    if (!subscriptionId || !subscriptionApiKey) return;
                    
                    setIsLoadingProjects(true);
                    
                    // Clear previous errors
                    setSubscriptionIdErrorText('');
                    setSubscriptionApiKeyErrorText('');
                    
                    // Hide error elements
                    const subscriptionIdError = document.getElementById('subscription-id-error') as HTMLElement;
                    const subscriptionApiKeyError = document.getElementById('subscription-api-key-error') as HTMLElement;
                    if (subscriptionIdError) subscriptionIdError.style.display = 'none';
                    if (subscriptionApiKeyError) subscriptionApiKeyError.style.display = 'none';
                    
                    try {
                      const subClient = new SubscriptionApiClient(subscriptionId, subscriptionApiKey);
                      const res = await subClient.getProjects();
                      if (res.success && res.data) {
                        // Build grouped environments by project
                        const newCreds: EnvironmentCredentials[] = [];
                        res.data.forEach(p => {
                          p.environments.forEach(env => {
                            newCreds.push({
                              environmentId: env.id,
                              deliveryApiKey: '',
                              managementApiKey: '',
                              subscriptionApiKey: subscriptionApiKey,
                              subscriptionId: subscriptionId
                            });
                          });
                        });
                        setEnvironmentCredentials(newCreds);
                        // Surface project/env grouping in UI by storing names alongside creds
                        setProjectEnvMap(res.data.reduce((acc: Record<string, { project: string; projectId: string; envName: string }>, p) => {
                          p.environments.forEach(e => {
                            acc[e.id] = { project: p.name, projectId: p.id, envName: e.name };
                          });
                          return acc;
                        }, {}));
                      } else {
                        console.error('Failed to load projects:', res.error);
                        // Handle specific error cases - SubscriptionApiClient returns string errors with status codes
                        if (typeof res.error === 'string') {
                          if (res.error.includes('400')) {
                            setSubscriptionIdErrorText('Invalid subscription ID. Please check your subscription ID.');
                            if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                          } else if (res.error.includes('401')) {
                            setSubscriptionApiKeyErrorText('Invalid API key. Please check your subscription API key.');
                            if (subscriptionApiKeyError) subscriptionApiKeyError.style.display = 'block';
                          } else {
                            setSubscriptionIdErrorText('Failed to load projects. Please check your credentials.');
                            if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                          }
                        } else if (res.error && typeof res.error === 'object') {
                          const errorCode = (res.error as any).status || (res.error as any).code;
                          if (errorCode === 400) {
                            setSubscriptionIdErrorText('Invalid subscription ID. Please check your subscription ID.');
                            if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                          } else if (errorCode === 401) {
                            setSubscriptionApiKeyErrorText('Invalid API key. Please check your subscription API key.');
                            if (subscriptionApiKeyError) subscriptionApiKeyError.style.display = 'block';
                          } else {
                            setSubscriptionIdErrorText('Failed to load projects. Please check your credentials.');
                            if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                          }
                        } else {
                          setSubscriptionIdErrorText('Failed to load projects. Please check your credentials.');
                          if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                        }
                      }
                    } catch (e: any) {
                      console.error('Error loading projects:', e);
                      // Handle network or other errors
                      if (e?.response?.status === 400) {
                        setSubscriptionIdErrorText('Invalid subscription ID. Please check your subscription ID.');
                        if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                      } else if (e?.response?.status === 401) {
                        setSubscriptionApiKeyErrorText('Invalid API key. Please check your subscription API key.');
                        if (subscriptionApiKeyError) subscriptionApiKeyError.style.display = 'block';
                      } else {
                        setSubscriptionIdErrorText('Failed to load projects. Please check your credentials.');
                        if (subscriptionIdError) subscriptionIdError.style.display = 'block';
                      }
                    } finally {
                      setIsLoadingProjects(false);
                    }
                  }}
                  disabled={isLoadingProjects}
                  className='btn continue-btn'
                >
                  {isLoadingProjects ? 'Loading Projects & Environments...' : 'Load Projects & Environments'}
                </button>
              </div>
            </div>
          )}

          {(appState.mode === 'single' || (appState.mode === 'subscription' && Object.keys(projectEnvMap).length > 0)) && (
            <div className='basis-full mb-6'>
              <div className='flex justify-between items-center mb-2'>
                <h3 className='text-lg font-semibold'>
                  {appState.mode === 'subscription' ? 'Projects & environments' : 'Environments'}
                </h3>
              </div>


            {/* Group by project name if available */}
            {appState.mode === 'subscription' && Object.keys(projectEnvMap).length > 0 ? (
              // Group environments by project in Subscription Analysis mode
              (() => {
                const projectGroups: Record<string, { creds: EnvironmentCredentials[], indices: number[], projectName: string }> = {};
                
                environmentCredentials.forEach((cred, index) => {
                  const projectId = projectEnvMap[cred.environmentId]?.projectId || 'unknown';
                  const projectName = projectEnvMap[cred.environmentId]?.project || 'Unknown Project';
                  if (!projectGroups[projectId]) {
                    projectGroups[projectId] = { creds: [], indices: [], projectName };
                  }
                  projectGroups[projectId].creds.push(cred);
                  projectGroups[projectId].indices.push(index);
                });

                return Object.entries(projectGroups)
                  .sort(([, a], [, b]) => a.projectName.localeCompare(b.projectName))
                  .map(([projectId, { creds, indices, projectName }]) => (
                <details key={projectId} className='mb-6' open>
                  <summary className='text-lg font-bold text-gray-800 cursor-pointer bg-[rgb(243,243,243)] environment-summary'>
                    {projectName} ({creds.length} environment{creds.length !== 1 ? 's' : ''})
                  </summary>
                    <div className='rounded-b-lg px-4 pb-4 pt-2 bg-[rgb(243,243,243)]'>
                      {creds.map((cred, groupIndex) => {
                        const originalIndex = indices[groupIndex];
                        return (
                          <div key={originalIndex} className='border border-gray-200 rounded-lg p-4 mb-4 bg-white'>
                            <div className='flex justify-between items-center mb-4'>
                              <h4 className='text-base font-bold text-gray-800'>
                                {projectEnvMap[cred.environmentId]?.envName} ({cred.environmentId})
                              </h4>
                              {environmentCredentials.length > 1 && (
                                <button
                                  onClick={() => removeEnvironmentCredential(originalIndex)}
                                  className='btn'
                                  style={{ 
                                    backgroundColor: 'var(--red)', 
                                    color: 'white',
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--darker-red)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--red)'}
                                >
                                  <svg 
                                    xmlns="http://www.w3.org/2000/svg" 
                                    fill="none" 
                                    viewBox="0 0 24 24" 
                                    strokeWidth={1.5} 
                                    stroke="currentColor" 
                                    style={{ width: '20px', height: '20px', marginRight: '8px' }}
                                  >
                                    <path 
                                      strokeLinecap="round" 
                                      strokeLinejoin="round" 
                                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" 
                                    />
                                  </svg>
                                  Delete
                                </button>
                              )}
                            </div>
                            <hr className='assets-divider within-container mb-6' />
                            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stack-inputs'>
                              <div>
                                <label className='block text-sm font-medium mb-2'>Environment ID</label>
                                <input
                                  type='text'
                                  value={cred.environmentId}
                                  onChange={(e) => updateEnvironmentCredential(originalIndex, 'environmentId', e.target.value)}
                                  className='w-full px-3 py-2 border border-gray-300 rounded-md'
                                  placeholder='Environment ID'
                                />
                              </div>
                              <div className='relative'>
                                <label className='block text-sm font-medium mb-2'>
                                  Delivery API Key
                                </label>
                                <input
                                  type='password'
                                  value={cred.deliveryApiKey || ''}
                                  onChange={(e) => updateEnvironmentCredential(originalIndex, 'deliveryApiKey', e.target.value)}
                                  className='w-full px-3 py-2 border border-gray-300 rounded-md'
                                  placeholder='Delivery API key'
                                />
                                <p id={`api-key-error-env-${originalIndex}-delivery`} className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10.5 left-[100px] text-xs'>
                                  {apiKeyValidationErrors[`env-${originalIndex}-delivery`]}
                                </p>
                              </div>
                              <div className='relative'>
                                <label className='block text-sm font-medium mb-2'>
                                  Management API Key
                                </label>
                                <input
                                  type='password'
                                  value={cred.managementApiKey || ''}
                                  onChange={(e) => updateEnvironmentCredential(originalIndex, 'managementApiKey', e.target.value)}
                                  className='w-full px-3 py-2 border border-gray-300 rounded-md'
                                  placeholder='Management API key (optional)'
                                />
                                <p id={`api-key-error-env-${originalIndex}-management`} className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10 left-[130px] text-xs'>
                                  {apiKeyValidationErrors[`env-${originalIndex}-management`]}
                                </p>
                              </div>
                            </div>
                            <div className='mt-4'>
                              <button
                                type='button'
                                onClick={() => applyKeysToSameProject(originalIndex)}
                                className='btn btn-compact'
                              >
                                Add keys to all environments in this project
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ));
              })()
            ) : (
              // Single Environment mode - show environments individually with expandable sections
              environmentCredentials.map((cred, index) => (
                <details key={index} className='mb-6' open>
                  <summary className='text-lg font-bold text-gray-800 cursor-pointer bg-[rgb(243,243,243)] environment-summary'>
                    <div className='flex justify-between items-center'>
                      <span>Environment {index + 1}</span>
                      {environmentCredentials.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeEnvironmentCredential(index);
                          }}
                          className='btn'
                          style={{ 
                            backgroundColor: 'var(--red)', 
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--darker-red)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--red)'}
                        >
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            strokeWidth={1.5} 
                            stroke="currentColor" 
                            style={{ width: '20px', height: '20px', marginRight: '8px' }}
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" 
                            />
                          </svg>
                          Delete
                        </button>
                      )}
                    </div>
                  </summary>
                  <div className='rounded-b-lg px-6 pb-6 pt-4 bg-white border-l border-r border-b border-gray-200'>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 stack-inputs'>
                      <div>
                        <label className='block text-sm font-medium mb-2'>Environment ID</label>
                        <input
                          type='text'
                          value={cred.environmentId}
                          onChange={(e) => updateEnvironmentCredential(index, 'environmentId', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Environment ID'
                        />
                      </div>
                      <div className='relative'>
                        <label className='block text-sm font-medium mb-2'>
                          Delivery API Key
                        </label>
                        <input
                          type='password'
                          value={cred.deliveryApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'deliveryApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Delivery API key'
                        />
                        <p id={`api-key-error-env-${index}-delivery`} className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10.5 left-[100px] text-xs'>
                          {apiKeyValidationErrors[`env-${index}-delivery`]}
                        </p>
                      </div>
                      <div className='relative'>
                        <label className='block text-sm font-medium mb-2'>
                          Management API Key
                        </label>
                        <input
                          type='password'
                          value={cred.managementApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'managementApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Management API key (optional)'
                        />
                        <p id={`api-key-error-env-${index}-management`} className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10 left-[130px] text-xs'>
                          {apiKeyValidationErrors[`env-${index}-management`]}
                        </p>
                      </div>
                      <div>
                        <label className='block text-sm font-medium mb-2'>
                          Subscription ID
                        </label>
                        <input
                          type='text'
                          value={cred.subscriptionId || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'subscriptionId', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Subscription ID (required for Subscription API)'
                        />
                      </div>
                      <div className='relative'>
                        <label className='block text-sm font-medium mb-2'>
                          Subscription API Key
                        </label>
                        <input
                          type='password'
                          value={cred.subscriptionApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'subscriptionApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Subscription API key (optional)'
                        />
                        <p id={`api-key-error-env-${index}-subscription`} className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg bottom-10 left-[150px] text-xs'>
                          {apiKeyValidationErrors[`env-${index}-subscription`]}
                        </p>
                      </div>
                    </div>
                  </div>
                </details>
              ))
            )}

            {appState.mode === 'single' && (
              <div 
                onClick={addEnvironmentCredential}
                className='rounded-lg p-4 mb-6 cursor-pointer transition-colors duration-200'
                style={{ backgroundColor: 'rgb(243, 243, 243)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'; }}
              >
                <div className='flex items-center justify-start py-8'>
                  <div className='flex items-center gap-2 text-gray-500 hover:text-gray-700'>
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      strokeWidth={1.5} 
                      stroke="currentColor" 
                      className="w-6 h-6"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        d="M12 4.5v15m7.5-7.5h-15" 
                      />
                    </svg>
                    <span className='text-lg font-medium'>Add environment</span>
                  </div>
                </div>
              </div>
            )}

            {validationErrors.length > 0 && (
              <div className='mt-6 p-4 bg-red-50 border border-red-200 rounded-lg'>
                <h4 className='text-sm font-semibold text-red-800 mb-2'>Please fix the following issues:</h4>
                <ul className='text-sm text-red-700 space-y-1'>
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className='flex justify-end mt-12'>
              <button
                onClick={collectUsageData}
                disabled={isCollectingData || environmentCredentials.length === 0 || !isFormValid()}
                className='btn continue-btn'
              >
                {isCollectingData ? 'Collecting Data...' : 'Collect Usage Data'}
              </button>
            </div>
            </div>
          )}
          {/* Always-visible back button for credentials step (both modes) */}
          <div className='flex justify-start mt-12 form-actions'>
            <button
              onClick={() => setAppState(prev => ({ ...prev, ui: { ...prev.ui, currentStep: 'mode-selection' } }))}
              className='btn back-btn'
            >
              Change analysis mode
            </button>
          </div>
        </div>
      )}

      {appState.ui.currentStep === 'data-collection' && (
        <div className='basis-full flex flex-wrap place-content-start'>
          <div className='basis-full mb-6'>
            <h2 className='text-xl font-bold mb-4 text-left'>Collecting Usage Data</h2>
            <p className='text-gray-600 mb-6 text-left'>Please wait while we collect data from your environments...</p>
          </div>

          <div className='basis-full'>
            {Object.entries(collectionProgress).map(([envId, status]) => (
              <div key={envId} className='border border-gray-200 rounded-lg p-4 mb-4'>
                <div className='flex justify-between items-center'>
                  <span className='font-medium'>{envId}</span>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    status === 'Completed' 
                      ? 'bg-green-100 text-green-800' 
                      : status.startsWith('Error')
                      ? 'bg-red-100 text-red-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {appState.ui.currentStep === 'results' && (
        <div className='basis-full flex flex-wrap place-content-start'>
          <div className='basis-full mb-6'>
            <div className='flex justify-between items-center'>
              <h2 className='text-xl font-bold'>Usage results</h2>
              <div className='flex gap-2'>
                <button
                  onClick={() => exportUsageReport('excel')}
                  className='btn continue-btn'
                >
                  Export Excel
                </button>
                <button
                  onClick={() => exportUsageReport('json')}
                  className='btn continue-btn'
                >
                  Export JSON
                </button>
                <button
                  onClick={() => exportUsageReport('csv')}
                  className='btn continue-btn'
                >
                  Export CSV
                </button>
              </div>
            </div>
          </div>

          <div className='basis-full'>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8'>
              {appState.data.environments.map((env) => (
                <div key={env.environmentId} className='border border-gray-200 rounded-lg p-6'>
                  <h3 className='text-sm font-medium text-gray-600'>Environment ID</h3>
                  <div className='font-mono font-bold text-sm mt-1 mb-4 break-all'>{env.environmentId}</div>
                  <div className='space-y-2'>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Content Items:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.contentItems, 'Delivery API key', env.apiKeysAvailable.delivery)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Content Types:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.contentTypes, 'Delivery API key', env.apiKeysAvailable.delivery)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Active Languages:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.languages, 'Delivery API key', env.apiKeysAvailable.delivery)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Assets:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.assetCount, 'Management API key', env.apiKeysAvailable.management)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Asset storage:</span>
                      <span className='font-medium'>
                        {env.apiKeysAvailable.management ? (
                          `${Math.round(env.metrics.assetStorageSize / 1024 / 1024 * 100) / 100} MB`
                        ) : (
                          <span 
                            className="text-gray-400 italic cursor-help" 
                            title="Requires Management API key"
                          >
                            Unavailable
                          </span>
                        )}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Collections:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.collections, 'Management API key', env.apiKeysAvailable.management)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Custom Roles:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.customRoles, 'Management API key', env.apiKeysAvailable.management)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Spaces:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.spaces, 'Management API key', env.apiKeysAvailable.management)}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-gray-600'>Active Users:</span>
                      <span className='font-medium'>
                        {formatMetricValue(env.metrics.activeUsers, 'Subscription API key', env.apiKeysAvailable.subscription)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className='flex justify-start'>
              <button
                onClick={() => setAppState(prev => ({ ...prev, ui: { ...prev.ui, currentStep: 'mode-selection' } }))}
                className='btn back-btn'
              >
                Start New Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy Asset Description Auditor UI */}
      {appState.ui.currentStep !== 'mode-selection' && 
       appState.ui.currentStep !== 'credentials' && 
       appState.ui.currentStep !== 'data-collection' && 
       appState.ui.currentStep !== 'results' && (
    <div>
      <div id='loading-container' className='basis-full fixed bg-white z-10 top-0 bottom-0 left-0 right-0 flex place-items-center'>
        <div className='basis-full flex flex-wrap'>
          <div className='basis-full flex flex-wrap place-content-center'>
            <div id='loading-general-text' className='basis-full mb-3'>{loadingText}</div>
            <span id='loading-general' className='loading-span text-6xl'></span>
          </div>
        </div>
      </div>
      {
        (!languages || languages.length === 0) && sdkLoaded && (
          <form onSubmit={(e) => handleSubmit(e, sdkResponse)} className='basis-full flex flex-wrap place-content-start'>
            {
              !sdkResponse?.context?.environmentId ? (
                <div className='basis-full relative flex flex-wrap mb-6'>
                  <label id='environment-id-label' htmlFor='environment-id' className='basis-full text-left mb-3 font-bold focus:border-color-(--orange)'>
                    Environment ID
                  <span className='tooltip-icon' title="The environment ID of the environment where your assets are located. This can be found under 'Environment settings', or as the value in the URL as shown: app.kontent.ai/<environment-id>.">ⓘ</span>
                  </label>
                  <input 
                    type='text' 
                    id='environment-id' 
                    name='environment-id' 
                    value={environmentIdInputValue}
                    onChange={(e) => setEnvironmentIdInputValue(e.target.value)}
                  />
                  <p id='environment-id-error' className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg top-0 left-[160px]'>
                    {environmentIdErrorText}
                  </p>
                </div>
              ) : (
                // Environment ID from SDK context
                <div className='basis-full relative flex flex-wrap mb-6'>
                  <label id='environment-id-label' className='basis-full text-left mb-3 font-bold'>
                    Environment ID
                    <span className='tooltip-icon' title="Environment ID retrieved from the custom app's context">ⓘ</span>
                  </label>
                  <div 
                    className='basis-full text-left text-sm mb-2'
                    style={{
                      border: '1px solid var(--color-gray-300)',
                      borderRadius: '9999px',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: 'var(--color-gray-100)',
                      color: 'var(--color-gray-500)',
                      fontSize: '14px',
                      minHeight: '32px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {sdkResponse.context.environmentId}
                  </div>
                </div>
              )
            }
            {
              // Show API key input for manual entry or when invalid from manual input
              (!sdkResponse?.config?.hasOwnProperty('managementApiKey') || !sdkResponse?.config?.managementApiKey || sdkResponse?.config?.managementApiKey.trim() === '' || apiKeyInvalid) && (
                <div className='basis-full relative flex flex-wrap'>
                  <label id='api-key-label' htmlFor='api-key' className='basis-full text-left mb-3 font-bold focus:border-color-(--orange)'>
                    Management API Key
                      <span className='tooltip-icon' title="You can find your Management API key from the left-hand navigation bar under 'Project settings' -> 'API keys'. Be sure that it has the 'Read assets' permission selected.">ⓘ</span>
                  </label>
                    <input type='text' id='api-key' name='api-key' className='mb-6' />
                    <p id='api-key-error' className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg top-0 left-[230px]'>
                    {apiKeyErrorText}
                    </p>
                </div>
              )
            }
            {
              // Show disabled API key field when invalid from config
              apiKeyErrorFromConfig && (
                <div className='basis-full relative flex flex-wrap mb-6'>
                  <label id='api-key-label' className='basis-full text-left mb-3 font-bold'>
                    Management API Key
                    <span className='tooltip-icon' title="API key retrieved from custom app configuration">ⓘ</span>
                  </label>
                  <div 
                    className='basis-full text-left text-sm mb-2'
                    style={{
                      border: '1px solid var(--color-gray-300)',
                      borderRadius: '9999px',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: 'var(--color-gray-100)',
                      color: 'var(--color-gray-500)',
                      fontSize: '14px',
                      minHeight: '32px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    API key configured in custom app settings
                  </div>
                  <p id='api-key-error' className='error absolute bg-(--red) text-white px-2 py-[0.25rem] rounded-lg top-0 left-[230px]'>
                    {apiKeyErrorText}
                    </p>
                  <p className='error bg-(--red) text-white px-2 py-[0.25rem] rounded-lg mt-2'>
                    The API key in your custom app configuration is invalid. Please update it in Kontent.ai Environment settings &gt; Custom apps.
                  </p>
                </div>
              )
            }
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: '1rem' }}>
              {!apiKeyErrorFromConfig && (
                <button type='submit' className='btn continue-btn' disabled={isLoading}>
                  Get assets
                </button>
              )}
            </div>
          </form>
        )
      }
        {(assets && assets.length > 0 && languages && languages.length > 0) && (
          <>
            <details open>
              <summary className='text-[16px] text-left font-bold cursor-pointer'>
                <div style={{ marginLeft: '28px', display: 'inline' }}>Languages</div>
              </summary>
              <div className='mb-6 mt-6' style={{ marginLeft: '24px' }}>
                <Select
                  id='lang-selector'
                  isMulti
                  options={languages?.map(lang => ({ value: lang.id, label: lang.name })) || []}
                  value={languages?.filter(lang => selectedLanguages.includes(lang.id)).map(lang => ({ value: lang.id, label: lang.name })) || []}
                  onChange={options => setSelectedLanguages(options.map((opt: any) => opt.value))}
                  className='basic-multi-select mb-6'
                  classNamePrefix='select'
                  placeholder='Select languages...'
                  closeMenuOnSelect={false}
                  styles={{
                    menu: base => ({ ...base, zIndex: 9999 }),
                    menuList: base => ({
                      ...base,
                      padding: 16
                    }),
                    valueContainer: base => ({
                      ...base,
                      padding: 0
                    }),
                    control: (base) => ({
                      ...base,
                      fontSize: '14px',
                      borderColor: 'transparent',
                      backgroundColor: 'var(--color-gray-100)',
                      padding: 16,
                      boxShadow: 'none',
                      borderRadius: '8px',
                      '&:hover': {
                        backgroundColor: 'var(--hover-gray)'
                      }
                    }),
                    input: (base) => ({
                      ...base,
                      fontSize: '14px',
                      border: 'none',
                      boxShadow: 'none',
                      outline: 'none',
                    }),
                    placeholder: (base) => ({
                      ...base,
                      fontSize: '14px',
                      textAlign: 'left',
                    }),
                    singleValue: (base) => ({
                      ...base,
                      fontSize: '14px',
                    }),
                    option: (base, state) => ({
                      ...base,
                      fontSize: '14px',
                      textAlign: 'left',
                      backgroundColor: state.isFocused ? 'var(--hover-gray)' : base.backgroundColor,
                      color: base.color,
                    }),
                    multiValue: (base) => ({
                      ...base,
                      fontSize: '14px',
                      borderRadius: '9999px',
                      margin: '2px 4px',
                      marginBottom: '6px',
                    }),
                    multiValueLabel: (base) => ({
                      ...base,
                      fontSize: '14px',
                      color: 'var(--lighter-black)',
                      paddingRight: '4px',
                    }),
                    multiValueRemove: (base) => ({
                      ...base,
                      fontSize: '14px',
                      color: 'var(--color-gray-400)',
                      cursor: 'pointer',
                      borderRadius: '50%',
                      padding: '0 4px',
                      transition: 'color 0.2s',
                      ':hover': {
                        color: 'var(--red)',
                      },
                      '& svg': {
                        display: 'none'
                      },
                      '&::after': {
                        content: '""',
                        display: 'block',
                        width: '24px',
                        height: '24px',
                        margin: '0 0 1px 0',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1' stroke='%23a3a3a3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M6 18 18 6M6 6l12 12' /%3E%3C/svg%3E")`,
                        backgroundSize: 'contain',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'center',
                        transition: 'background-image 0.2s'
                      },
                      ':hover::after': {
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1' stroke='%23db0000'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M6 18 18 6M6 6l12 12' /%3E%3C/svg%3E")`
                      }
                    }),
                    noOptionsMessage: (base) => ({
                      ...base,
                      fontSize: '14px',
                      textAlign: 'left',
                    }),
                    clearIndicator: (base) => ({
                      ...base,
                      color: 'var(--color-gray-400)',
                      cursor: 'pointer',
                      ':hover': {
                        color: 'var(--red)'
                      },
                      '& svg': {
                        display: 'none'
                      },
                      '&::after': {
                        content: '""',
                        display: 'block',
                        width: '28px',
                        height: '28px',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 28 28' stroke-width='1' stroke='%23a3a3a3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M7 7l14 14M21 7l-14 14' /%3E%3C/svg%3E")`,
                        backgroundSize: 'contain',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'center',
                        transition: 'background-image 0.2s'
                      },
                      ':hover::after': {
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 28 28' stroke-width='1' stroke='%23db0000'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M7 7l14 14M21 7l-14 14' /%3E%3C/svg%3E")`
                      }
                    }),
                    dropdownIndicator: (base, state) => ({
                      ...base,
                      color: 'var(--color-gray-400)',
                      cursor: 'pointer',
                      transition: 'color 0.2s',
                      ':hover': {
                        color: 'var(--lighter-black)'
                      },
                      '& svg': {
                        display: 'none'
                      },
                      '&::after': {
                        content: '""',
                        display: 'block',
                        width: '24px',
                        height: '24px',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1' stroke='%23a3a3a3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5' /%3E%3C/svg%3E")`,
                        backgroundSize: 'contain',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'center',
                        transition: 'background-image 0.2s, transform 0.2s ease',
                        transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                      },
                      ':hover::after': {
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1' stroke='%23151515'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5' /%3E%3C/svg%3E")`
                      }
                    }),
                  }}
                />
                <div className='mt-2 w-full flex items-center justify-end mb-12'>
                  <button type='button' onClick={handleSelectAllLanguages} className='btn continue-btn'>Select All</button>
                </div>
              </div>
            </details>
            <hr className='assets-divider' />
                        <details open>
              <summary className='text-[16px] text-left font-bold cursor-pointer'>
                <div style={{ marginLeft: '28px', display: 'inline' }}>Overview</div>
              </summary>
              {selectedLanguages.length === 0 ? (
                <div
                  style={{
                    background: 'none',
                    color: 'var(--color-gray-500)',
                    borderRadius: '8px',
                    border: '1px solid var(--color-gray-300)',
                    padding: '24px 20px',
                    fontSize: '14px',
                    fontWeight: 500,
                    margin: '18px 24px 36px 24px',
                    width: 'calc(100% - 24px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    lineHeight: 1.6,
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: '16px', color: 'var(--color-gray-500)' }}>
                    No languages selected
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--color-gray-500)' }}>
                    Please select at least one language to view your asset overview
                  </div>
                </div>
              ) : (
                <>
                  <div
                  style={{
                    background: 'none',
                    color: 'var(--lighter-black)',
                    borderRadius: '8px',
                    border: '1px solid var(--color-gray-400)',
                    padding: '12px 20px',
                    fontSize: '14px',
                    fontWeight: 500,
                    margin: '18px 24px',
                    width: 'calc(100% - 24px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    lineHeight: 1.7
                  }}
                >
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <span style={{ minWidth: '243.5px', textAlign: 'left' }}>Total assets</span>
                    <strong style={{ color: 'var(--purple)' }}>{filteredAssets?.length ?? 0}</strong>
                  </div>
                  <hr className='assets-divider within-container' />
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <span style={{ minWidth: '225px', textAlign: 'left' }}>
                      Described in all selected languages
                      <span className='tooltip-icon-small' title="This tells you how many assets have a description in all languages selected in the 'Languages' section above. For example, if you have English and Spanish selected, the following value will tell you how many assets have a description in both English and Spanish.">ⓘ</span>
                      </span>
                    <strong style={{ color: 'var(--purple)' }}>{overviewData[0]?.fullyDescribed ?? 0}</strong>
                  </div>
                </div>
                <table
                  className='table-modern mb-6 mt-4'
                  style={{ maxWidth: '100%', width: 'calc(100% - 24px)', margin: '24px' }}
                >
                  <thead>
                    <tr>
                      <th>Language</th>
                      <th>Percentage with Description</th>
                      <th>Number with Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewData.map(lang => (
                      <tr key={lang.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {lang.name}
                            {lang.isDefault && (
                              <span
                                style={{
                                  backgroundColor: 'var(--lighter-purple)',
                                  color: 'var(--purple)',
                                  borderRadius: '9999px',
                                  padding: '2px 8px',
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px'
                                }}
                              >
                                Default
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{lang.percent}%</td>
                        <td>
                          {lang.withDescription}
                          <span className="overview-total-fraction"> / {filteredAssets?.length ?? 0}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className='w-full flex justify-end mb-12'>
                  <button
                    className='btn continue-btn'
                    onClick={handleExportOverview}
                    disabled={isExportOverviewLoading}
                  >
                    <span id='loading-export-overview' className={isExportOverviewLoading ? 'loading-span' : 'hidden'}></span>
                    Export Overview
                                      </button>
                  </div>
                </>
              )}
            </details>
            <hr className='assets-divider' />
            {/* Main Asset Table Section */}
            <details open>
              <summary id='assets-summary' className='text-[16px] text-left font-bold cursor-pointer'>
                <div style={{ marginLeft: '28px', display: 'inline' }}>Asset details</div>
              </summary>
              {/* Search input and filter controls moved here, above the main asset table */}
              <div className='mb-16 mt-4 asset-details-controls' style={{ marginLeft: '24px' }}>
                <div className='mb-4'>
                  <div className='search-input-wrapper' style={{ position: 'relative', width: '100%' }}>
                    <input
                      type='text'
                      placeholder='Search assets by title or description...'
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className='search-input'
                      style={{ width: '100%', height: '29px' }}
                    />
                    {searchQuery && (
                      <button
                        id='clear-search-btn'
                        type='button'
                        onClick={() => setSearchQuery('')}
                        title='Clear search'
                        aria-label='Clear search'
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: 0,
                          bottom: 0,
                          margin: 'auto 0',
                          height: '29px', // 21px height + 3px top + 3px bottom padding
                          width: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-gray-400)',
                          fontSize: 20,
                          cursor: 'pointer',
                          lineHeight: 1,
                          padding: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-gray-400)')}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" style={{ width: '24px', height: '24px' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className='flex items-center justify-start'>
                  <label className='flex items-center'>
                    <input
                      type='checkbox'
                      checked={showOnlyMissing}
                      onChange={handleShowOnlyMissing}
                    />
                    <span className='show-only-checkbox-label ml-2'>Show only assets missing descriptions in selected languages</span>
                  </label>
                </div>
              </div>
              {/* Table container with navigation buttons */}
              <div
                id='table-container'
                className={`table-container mb-6 ${paginatedAssets.length < pageSize ? 'has-few-results' : ''}`}
                ref={tableContainerRef}
                style={{
                  width: 'calc(100% - 24px)',
                  marginLeft: '24px',
                  minHeight: debouncedQuery ? initialTableHeight || undefined : undefined,
                  position: 'relative'
                }}
              >
                <table className='table-modern' style={{ minWidth: '1200px' }}>
        <colgroup>
          <col id='asset-visual' style={{ width: 64 }} />
          <col id='title' style={{ width: 200 }} />
                    {languages?.filter(lang => selectedLanguages.includes(lang.id)).map(lang => (
                      <col key={lang.id} id={lang.codename}></col>
                    ))}
        </colgroup>
        <thead>
          <tr>
            <th className='sticky-col first-col title-header'></th>
            <th className='sticky-col second-col title-header'>Title</th>
            {languages?.filter(lang => selectedLanguages.includes(lang.id)).map(lang => (
              <th key={lang.id} className='lang-header'>
                {lang.name}
                {lang.isDefault && (
                  <div style={{
                    backgroundColor: 'var(--lighter-purple)',
                    color: 'var(--purple)',
                    borderRadius: '9999px',
                    padding: '2px 8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    display: 'inline-block',
                    marginLeft: '8px'
                  }}>
                    Default
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
                    {paginatedAssets.length > 0 ?
                      paginatedAssets.map((asset) => (
                        <tr key={asset.id}>
                          <td className='sticky-col first-col'>
                            <div style={{ position: 'relative', width: 64, height: 64, display: 'inline-block' }}>
                              {isImageAsset(asset)
                                ? ((asset.size < 50000000 &&
                                    ((asset.imageWidth ?? 0) <= 12000 && (asset.imageHeight ?? 0) <= 12000))
                                  ? (
                                    <a href={asset.url} target='_blank' rel='noopener noreferrer' title='View full size'>
                                      <img
                                        src={`${asset.url}?w=128&h=128`}
                                        alt={asset.title || asset.fileName}
                                        className='asset-thumbnail'
                                        loading='lazy'
                                      />
                                    </a>
                                  ) : (
                                    <a href={asset.url} target='_blank' rel='noopener noreferrer' title='View full size'>
                                      <div
                                        className='asset-thumbnail asset-placeholder-thumbnail'
                                        title='No preview available'
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          height: '100%',
                                          width: '100%',
                                          fontWeight: 600,
                                          fontSize: '14px',
                                          color: 'var(--color-gray-500)',
                                          background: 'rgb(248, 248, 248)',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.5px',
                                          userSelect: 'none',
                                          textAlign: 'center',
                                        }}
                                      >
                                        <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--color-gray-400)', textTransform: 'none', marginTop: 2 }}>
                                          No preview available
                                        </span>
                                      </div>
                                    </a>
                                  )
                                )
                                : (
                                  <div
                                    className='asset-thumbnail asset-placeholder-thumbnail'
                                    title={asset.type || 'File'}
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      height: '100%',
                                      width: '100%',
                                      fontWeight: 600,
                                      fontSize: '11px',
                                      color: 'var(--color-gray-500)',
                                                                                background: 'rgb(248, 248, 248)',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.5px',
                                      userSelect: 'none',
                                      textAlign: 'center',
                                      padding: '0 2px'
                                    }}
                                  >
                                    <span>
                                      {(() => {
                                        if (!asset.type) return 'FILE';

                                        const type = asset.type.toLowerCase();

                                        if (type.includes('pdf')) return 'PDF';
                                        if (type.startsWith('video/')) return 'VIDEO';
                                        if (type.startsWith('audio/')) return 'AUDIO';
                                        if (type.includes('word')) return 'DOC';
                                        if (type.includes('excel')) return 'XLS';
                                        if (type.includes('powerpoint')) return 'PPT';
                                        if (type.includes('zip') || type.includes('compressed') || type.includes('archive')) return 'ARCHIVE';
                                        if (type.includes('text')) return 'TEXT';
                                        if (type.startsWith('model')) return 'MODEL';
                                        if (type.includes('font')) return 'FONT';
                                        
                                        // Handle application types systematically
                                        if (type.startsWith('application/')) {
                                          // Archives and compressed files
                                          if (type.includes('zip') || type.includes('rar') || type.includes('7z') || 
                                              type.includes('gzip') || type.includes('tar') || type.includes('bzip2') ||
                                              type.includes('compressed')) return 'ARCHIVE';
                                          
                                          // Executable and installer files
                                          if (type.includes('executable') || type.includes('x-executable') ||
                                              type.includes('msdownload') || type.includes('msi') ||
                                              type.includes('apple-diskimage') || type.includes('android.package-archive')) return 'EXE';
                                          
                                          // Script and code files
                                          if (type.includes('javascript') || type.includes('ecmascript') ||
                                              type.includes('python') || type.includes('php') ||
                                              type.includes('ruby') || type.includes('shellscript')) return 'SCRIPT';
                                          
                                          // Browser plugins and extensions
                                          if (type.includes('shockwave-flash') || type.includes('java-applet') ||
                                              type.includes('browser-extension')) return 'PLUGIN';
                                          
                                          // Structured data files
                                          if (type.includes('json') || type.includes('xml') || type.includes('yaml') ||
                                              type.includes('csv') || type.includes('sql') || type.includes('geo+json')) return 'DATA';
                                          
                                          // Generic binary files
                                          if (type.includes('octet-stream') || type.includes('binary') || type.includes('unknown')) return 'BINARY';
                                          
                                          // Default: treat as document (covers Office files, PDFs, RTF, etc.)
                                          return 'DOCUMENT';
                                        }
                                        
                                        return 'FILE';
                                      })()}
                                    </span>
                                    <span style={{
                                      fontWeight: 400,
                                      fontSize: '10px',
                                      color: 'var(--color-gray-400)',
                                      textTransform: 'none',
                                      lineHeight: 1.2
                                    }}>
                                      No preview
                                    </span>
                                  </div>
                                )}
                              <a
                                href={`https://app.kontent.ai/${environmentId}/content-inventory/assets/asset/${asset.id}`}
                                target='_blank'
                                rel='noopener noreferrer'
                                className='asset-edit-link'
                                title='Edit asset in Kontent.ai'
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" className="size-7">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                </svg>
                              </a>
                            </div>
                          </td>
                          <td className='sticky-col second-col'>
                            {asset.title && asset.title.trim() !== '' ? asset.title : asset.fileName}
                          </td>
                          {languages?.filter(lang => selectedLanguages.includes(lang.id)).map(lang => {
                            const desc = asset.descriptions.find((d: any) => d.language.id === lang.id);
                            return (
                              <td key={lang.id} className={desc && desc.description ? 'cell bg-green-100' : 'cell bg-red-100'}>
                                {desc && desc.description ? desc.description : 'None'}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                      : (
                        <tr>
                          <td colSpan={2 + (languages?.filter(lang => selectedLanguages.includes(lang.id)).length || 0)} style={{ textAlign: 'left', padding: '2.5rem 24px', color: 'var(--color-gray-500)', fontSize: 16 }}>
                            No assets found matching your search
                          </td>
                        </tr>
                      )
                    }
                  </tbody>
                </table>
                

              </div>
              

              

              
              <div className='mt-4 mb-16 pagination-row'>
                <div className='pagination-center'>
                  {computedPageCount > 1 && (
                    <>
                      {/* Previous button */}
                      <button
                        className='page-btn'
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        style={{ marginRight: 4 }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mr-2 mb-0.5 inline size-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                        Previous
                      </button>
                      {/* Page numbers with ellipsis */}
                      {(() => {
                        const pages = [];
                        const total = computedPageCount;
                        const curr = currentPage;
                        // Always show first and last
                        // Show 2 before and after current
                        // Use ellipsis where needed
                        const pageWindow = 2;
                        let left = Math.max(2, curr - pageWindow);
                        let right = Math.min(total - 1, curr + pageWindow);
                        if (curr - 1 <= pageWindow) {
                          right = Math.min(total - 1, right + (pageWindow - (curr - 2)));
                        }
                        if (total - curr <= pageWindow) {
                          left = Math.max(2, left - (pageWindow - (total - curr - 1)));
                        }
                        // First page
                        pages.push(
                          <button
                            key={1}
                            className={`page-btn${curr === 1 ? ' page-btn-active' : ''}`}
                            onClick={() => setCurrentPage(1)}
                            style={{ margin: 0 }}
                            disabled={curr === 1}
                          >
                            1
                          </button>
                        );
                        // Ellipsis after first page
                        if (left > 2) {
                          pages.push(<span key='start-ellipsis' style={{ padding: '0 8px' }}>…</span>);
                        }
                        // Page window
                        for (let i = left; i <= right; i++) {
                          pages.push(
                            <button
                              key={i}
                              className={`page-btn${curr === i ? ' page-btn-active' : ''}`}
                              onClick={() => setCurrentPage(i)}
                              style={{ margin: 0 }}
                              disabled={curr === i}
                            >
                              {i}
                            </button>
                          );
                        }
                        // Ellipsis before last page
                        if (right < total - 1) {
                          pages.push(<span key='end-ellipsis' style={{ padding: '0 8px' }}>…</span>);
                        }
                        // Last page
                        if (total > 1) {
                          pages.push(
                            <button
                              key={total}
                              className={`page-btn${curr === total ? ' page-btn-active' : ''}`}
                              onClick={() => setCurrentPage(total)}
                              style={{ margin: 0 }}
                              disabled={curr === total}
                            >
                              {total}
                            </button>
                          );
                        }
                        return pages;
                      })()}
                      {/* Next button */}
                      <button
                        className='page-btn'
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === computedPageCount}
                        style={{ marginLeft: 4 }}
                      >
                        Next
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="ml-2 mb-0.5 inline size-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                <button
                  className='btn continue-btn'
                  onClick={handleExportAssets}
                  disabled={isExportAssetsLoading}
                >
                  <span id='loading-export-assets' className={isExportAssetsLoading ? 'loading-span' : 'hidden'}></span>
                  Export Assets
                </button>
              </div>
            </details>
            {(window.self === window.top || 
              !sdkResponse?.context?.environmentId || 
              !sdkResponse?.config?.managementApiKey || 
              sdkResponse?.config?.managementApiKey.trim() === '') && (
                <hr className='assets-divider' />
            )}
            {/* Only show "Change settings" button if manual input is needed or configuration is incomplete */}
            {(window.self === window.top || 
              !sdkResponse?.context?.environmentId || 
              !sdkResponse?.config?.managementApiKey || 
              sdkResponse?.config?.managementApiKey.trim() === '') && (
              <div className='w-full flex justify-start mt-12 mb-12'>
                <button id='back-btn' type='button' className='btn back-btn' onClick={() => handleBackBtn()}>
                  Change settings
                </button>
              </div>
            )}
          </>
        )}
    </div>
      )}
    </>
  )
}

export default App