import { useEffect, useState, useRef } from 'react'
import './App.css'
import * as XLSX from 'xlsx';
import type { 
  AppState, 
  EnvironmentCredentials, 
  EnvironmentData
} from './types';
import { KontentApiClient, SubscriptionApiClient } from './api-clients';

function App() {
  // Main app state
  const [appState, setAppState] = useState<AppState>({
    mode: 'individual',
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

  // SDK and loading state
  const [loadingText, setLoadingText] = useState<React.ReactNode>('Fetching assets...');
  const [sdkResponse, setSdkResponse] = useState<any>(null);
  const [isDialogMode, setIsDialogMode] = useState(false);

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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedInitialized, setExpandedInitialized] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const [exportDropdownWidth, setExportDropdownWidth] = useState<number | undefined>(undefined);

  // New functions for usage insights
  // Prevent body scrolling when loading overlay is visible and scroll to top
  useEffect(() => {
    if (isCollectingData) {
      document.body.style.overflow = 'hidden';
      // Scroll to top when loading starts (respecting reduced motion preference)
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
      window.scrollTo({ top: 0, behavior });
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isCollectingData]);

  // Back-to-top behavior
  useEffect(() => {
    const onScroll = () => {
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight
      );
      const viewport = window.innerHeight;
      const canScroll = docHeight > viewport + 80; // avoid showing when page is short
      setShowBackToTop(canScroll && window.scrollY > 300 && !isCollectingData);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll as any);
      window.removeEventListener('resize', onScroll as any);
    };
  }, [isCollectingData]);

  // Detect mouse vs keyboard navigation for focus styling
  useEffect(() => {
    const handleMouseDown = () => {
      document.body.classList.remove('using-keyboard');
      document.body.classList.add('using-mouse');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab, Shift+Tab, Arrow keys, Enter, Space indicate keyboard navigation
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') {
        document.body.classList.remove('using-mouse');
        document.body.classList.add('using-keyboard');
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Match dropdown width to Export button width
  useEffect(() => {
    if (exportButtonRef.current) {
      setExportDropdownWidth(exportButtonRef.current.offsetWidth);
    }
  }, [isExportDropdownOpen]);

  // Apply dialog mode class to root
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      if (isDialogMode) {
        root.classList.add('dialog-mode');
      } else {
        root.classList.remove('dialog-mode');
      }
    }
  }, [isDialogMode]);

  // Handle click outside to close export dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setIsExportDropdownOpen(false);
      }
    };

    if (isExportDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExportDropdownOpen]);

  const handleBackToTop = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  };
  // Smoothly scroll to the first visible error element, opening any parent <details> if needed
  const scrollToFirstError = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

    // Gather candidates: visible error elements and the validation errors container
    const errorNodes: HTMLElement[] = [];
    // Find all error elements by their IDs
    const errorSelectors = [
      '[id^="api-key-error"]',
      '[id^="subscription-id-error"]',
      '[id^="subscription-api-key-error"]',
      '[id^="environment-id-error"]'
    ];
    errorSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach((el) => {
        const element = el as HTMLElement;
        if (!element.classList.contains('hidden')) {
          errorNodes.push(element);
        }
      });
    });

    const validationBox = document.getElementById('validation-errors');
    if (validationBox) {
      errorNodes.push(validationBox);
    }

    if (errorNodes.length === 0) return;

    // Pick the one highest on the page
    let topMost: HTMLElement | null = null;
    let minTop = Number.POSITIVE_INFINITY;
    for (const node of errorNodes) {
      // Ensure any parent <details> is opened so the element can be scrolled to
      const parentDetails = node.closest('details');
      if (parentDetails && !parentDetails.open) {
        parentDetails.open = true;
      }
      const rect = node.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;
      if (absoluteTop < minTop) {
        minTop = absoluteTop;
        topMost = node;
      }
    }

    if (topMost) {
      // Offset a bit so the element isn't flush with the very top
      const targetY = Math.max(0, minTop - 80);
      window.scrollTo({ top: targetY, behavior });
    }
  };
  const handleModeSelection = (mode: 'individual' | 'all') => {
    setAppState(prev => ({
      ...prev,
      mode,
      ui: {
        ...prev.ui,
        currentStep: 'credentials'
      }
    }));

    // Reset expansion initialization when switching modes
    setExpandedInitialized(false);

    // Ensure at least one environment is present in individual mode
    if (mode === 'individual') {
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
    setEnvironmentCredentials(prev => {
      const next = [...prev, newCredential];
      // Expand only the newly added environment, keep others as they are
      const newIndex = next.length - 1;
      setExpandedSections(prevSet => {
        const newSet = new Set(prevSet);
        newSet.add(`env-${newIndex}`);
        return newSet;
      });
      // Prevent auto re-initialization from useEffect
      setExpandedInitialized(true);
      return next;
    });
    // Clear validation errors when adding environment
    setValidationErrors([]);
    setApiKeyValidationErrors({});
    
    // Hide all API key error elements
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      element.classList.add('hidden');
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
      // Handle special case for subscriptionId -> subscription-id
      if (field === 'subscriptionId') {
        delete newErrors[`env-${index}-subscription-id`];
      } else {
        delete newErrors[`env-${index}-${field.replace('ApiKey', '').replace('Id', '')}`];
      }
      return newErrors;
    });
    
    // Hide the error element for this field
    let errorElementId: string;
    if (field === 'subscriptionId') {
      errorElementId = `api-key-error-env-${index}-subscription-id`;
    } else {
      errorElementId = `api-key-error-env-${index}-${field.replace('ApiKey', '').replace('Id', '')}`;
    }
    const errorElement = document.getElementById(errorElementId) as HTMLElement;
    if (errorElement) {
      errorElement.classList.add('hidden');
    }
  };

  const removeEnvironmentCredential = (index: number) => {
    setEnvironmentCredentials(prev => prev.filter((_, i) => i !== index));
    // Clear validation errors when removing environment
    setValidationErrors([]);
    setApiKeyValidationErrors({});
    
    // Hide all API key error elements
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      element.classList.add('hidden');
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

  // Validate UUID length (36 characters for standard UUID format)
  const isValidUuidLength = (id: string): boolean => {
    return id.trim().length === 36;
  };

  // Validate that all environments have at least one API key
  const validateEnvironmentCredentials = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    environmentCredentials.forEach((cred, index) => {
      if (!cred.environmentId.trim()) {
        errors.push(`Environment ${index + 1}: Environment ID is required`);
        return;
      }
      
      if (!isValidUuidLength(cred.environmentId)) {
        errors.push(`Environment ${index + 1}: Environment ID must be 36 characters (UUID format)`);
        return;
      }
      
      // Validate subscription ID if provided (must be 36 characters)
      if (cred.subscriptionId?.trim() && !isValidUuidLength(cred.subscriptionId)) {
        errors.push(`Environment ${index + 1}: Subscription ID must be 36 characters (UUID format)`);
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
            errors[`env-${i}-delivery`] = typeof testResult.error === 'string' ? testResult.error : 'Invalid Delivery Preview API key. Please verify your key and try again.';
          }
        } catch (error) {
          errors[`env-${i}-delivery`] = 'Invalid Delivery Preview API key. Please verify your key and try again.';
        }
      }
      
      // Test Management API key if provided
      if (cred.managementApiKey?.trim()) {
        try {
          const client = new KontentApiClient(cred);
          const testResult = await client.testManagementApiKey(cred.environmentId, cred.managementApiKey);
          if (!testResult.success) {
            errors[`env-${i}-management`] = typeof testResult.error === 'string' ? testResult.error : 'Invalid Management API key. Please verify your key and try again.';
          }
        } catch (error) {
          errors[`env-${i}-management`] = 'Invalid Management API key. Please verify your key and try again.';
        }
      }
      
      // Test Subscription API key if provided
      if (cred.subscriptionApiKey?.trim() && cred.subscriptionId?.trim()) {
        try {
          const subClient = new SubscriptionApiClient(cred.subscriptionId, cred.subscriptionApiKey);
          const testResult = await subClient.testSubscriptionApiKey();
          if (!testResult.success) {
            const errorMessage = typeof testResult.error === 'string' ? testResult.error : 'Invalid Subscription API key. Please verify your key and try again.';
            // Check if error is about Subscription ID (400 status) vs Subscription API key (401 status)
            if (errorMessage.includes('Subscription ID') || errorMessage.includes('subscription ID')) {
              errors[`env-${i}-subscription-id`] = errorMessage;
            } else {
              errors[`env-${i}-subscription`] = errorMessage;
            }
          }
        } catch (error) {
          errors[`env-${i}-subscription`] = 'Invalid Subscription API key. Please verify your key and try again.';
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
    // In "all environments" mode, also validate subscription ID length
    if (appState.mode === 'all') {
      if (!subscriptionId.trim() || !isValidUuidLength(subscriptionId)) {
        return false;
      }
    }
    return validateEnvironmentCredentials().isValid;
  };

  // Collapse all expandable sections
  const collapseAllSections = () => {
    setExpandedSections(new Set());
    setExpandedInitialized(true);
  };

  // Expand all expandable sections
  const expandAllSections = () => {
    const isResultsPage = appState.ui.currentStep === 'results';
    
    if (appState.mode === 'all' && Object.keys(projectEnvMap).length > 0) {
      const projectIds = Object.keys(projectEnvMap).map(envId => projectEnvMap[envId].projectId);
      const uniqueProjectIds = [...new Set(projectIds)];
      const prefix = isResultsPage ? 'results-project-' : 'project-';
      setExpandedSections(new Set(uniqueProjectIds.map(id => `${prefix}${id}`)));
    } else if (appState.mode === 'individual' && environmentCredentials.length > 0) {
      setExpandedSections(new Set(environmentCredentials.map((_, index) => `env-${index}`)));
    }
    setExpandedInitialized(true);
  };

  // Initialize sections as expanded when environments are loaded
  useEffect(() => {
    // Initialize expansions only once per mode/view, do not override user actions
    if (expandedInitialized) return;
    if (appState.mode === 'all' && Object.keys(projectEnvMap).length > 0) {
      const projectIds = Object.keys(projectEnvMap).map(envId => projectEnvMap[envId].projectId);
      const uniqueProjectIds = [...new Set(projectIds)];
      setExpandedSections(new Set(uniqueProjectIds.map(id => `project-${id}`)));
      setExpandedInitialized(true);
    } else if (appState.mode === 'individual' && environmentCredentials.length > 0) {
      setExpandedSections(new Set(environmentCredentials.map((_, index) => `env-${index}`)));
      setExpandedInitialized(true);
    }
  }, [appState.mode, projectEnvMap, environmentCredentials, expandedInitialized]);

  // Initialize results sections as expanded when results are loaded
  useEffect(() => {
    if (appState.ui.currentStep === 'results') {
      if (appState.mode === 'all' && Object.keys(projectEnvMap).length > 0) {
        const projectIds = Object.keys(projectEnvMap).map(envId => projectEnvMap[envId].projectId);
        const uniqueProjectIds = [...new Set(projectIds)];
        setExpandedSections(new Set(uniqueProjectIds.map(id => `results-project-${id}`)));
      }
      // Individual environments mode no longer uses expandable sections on results page
    }
  }, [appState.ui.currentStep, appState.mode, projectEnvMap, appState.data.environments]);

  const collectUsageData = async () => {
    // Prevent multiple simultaneous requests
    if (isCollectingData) {
      return;
    }

    setIsCollectingData(true);
    // Show full-screen loading overlay (reuse legacy loading UI)
    const loadingContainer = document.getElementById('loading-container') as HTMLElement;
    if (loadingContainer) {
      setLoadingText('Validating credentials...');
      loadingContainer.style.display = 'flex';
    }
    
    // Validate credentials before proceeding
    const validation = validateEnvironmentCredentials();
    setValidationErrors(validation.errors);
    
    if (!validation.isValid) {
      setIsCollectingData(false);
      // Wait a tick so the validation UI renders, then scroll
      setTimeout(scrollToFirstError, 0);
      if (loadingContainer) loadingContainer.style.display = 'none';
      return;
    }

    // Test API key validity before proceeding
    setApiKeyValidationErrors({});
    setLoadingText('Testing API keys...');
    
    // Hide all API key error elements before testing
    document.querySelectorAll('[id^="api-key-error-"]').forEach(element => {
      element.classList.add('hidden');
    });
    
    const apiKeyValidation = await testApiKeyValidity();
    setApiKeyValidationErrors(apiKeyValidation.errors);
    
    if (!apiKeyValidation.isValid) {
      // Show error elements for invalid API keys
      Object.keys(apiKeyValidation.errors).forEach(errorKey => {
        const errorElement = document.getElementById(`api-key-error-${errorKey}`) as HTMLElement;
        if (errorElement) {
          errorElement.classList.remove('hidden');
          errorElement.style.display = ''; // Clear any inline display style
        }
      });
      // Wait a tick to ensure styles have applied, then scroll to first error
      setTimeout(scrollToFirstError, 0);
      setIsCollectingData(false);
      if (loadingContainer) loadingContainer.style.display = 'none';
      return;
    }

    setCollectionProgress({});
    
    const environments: EnvironmentData[] = [];
    
    try {
      for (let i = 0; i < environmentCredentials.length; i++) {
        const cred = environmentCredentials[i];
        if (!cred.environmentId) continue;
        // Update loading text per environment (include ID when name available for clarity)
        const envName = projectEnvMap[cred.environmentId]?.envName;
        const envId = cred.environmentId;
        if (envName) {
          setLoadingText(
            <>Collecting data for <strong>{envName} ({envId})</strong>...</>
          );
        } else {
          setLoadingText(
            <>Collecting data for <strong>Environment {i + 1} ({envId})</strong>...</>
          );
        }
        
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
                  if (loadingContainer) loadingContainer.style.display = 'none';
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
    // Check if any environments have names in projectEnvMap (all environments mode)
    const hasEnvironmentNames = environments.some(env => projectEnvMap[env.environmentId]?.envName);
    const hasProjectInfo = environments.some(env => projectEnvMap[env.environmentId]?.project);
    
    // Sort environments by project name, then environment name (if available)
    const sortedEnvironments = [...environments].sort((a, b) => {
      const projectA = projectEnvMap[a.environmentId]?.project || '';
      const projectB = projectEnvMap[b.environmentId]?.project || '';
      if (projectA !== projectB) {
        return projectA.localeCompare(projectB);
      }
      const nameA = projectEnvMap[a.environmentId]?.envName || '';
      const nameB = projectEnvMap[b.environmentId]?.envName || '';
      return nameA.localeCompare(nameB);
    });
    
    const headers = hasEnvironmentNames
      ? hasProjectInfo
        ? ['Project name', 'Environment name', 'Environment ID', 'Active languages', 'Active users', 'Asset count', 'Asset storage (MB)', 'Collections', 'Content items (all languages)', 'Content types', 'Custom roles', 'Spaces']
        : ['Environment ID', 'Environment name', 'Active languages', 'Active users', 'Asset count', 'Asset storage (MB)', 'Collections', 'Content items (all languages)', 'Content types', 'Custom roles', 'Spaces']
      : ['Environment ID', 'Active languages', 'Active users', 'Asset count', 'Asset storage (MB)', 'Collections', 'Content items (all languages)', 'Content types', 'Custom roles', 'Spaces'];
    
    const wsData = [
      headers,
      ...sortedEnvironments.map(env => {
        const projectName = projectEnvMap[env.environmentId]?.project || '';
        const envName = projectEnvMap[env.environmentId]?.envName || env.name;
        const metrics = [
          env.metrics.languages,
          env.metrics.activeUsers,
          env.metrics.assetCount,
          Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100,
          env.metrics.collections,
          env.metrics.contentItems,
          env.metrics.contentTypes,
          env.metrics.customRoles,
          env.metrics.spaces
        ];
        // Build row based on what columns we have
        if (hasProjectInfo && hasEnvironmentNames) {
          return [projectName, envName, env.environmentId, ...metrics];
        } else if (hasEnvironmentNames) {
          return [env.environmentId, envName, ...metrics];
        } else {
          return [env.environmentId, ...metrics];
        }
      })
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Usage Report');
    XLSX.writeFile(wb, `kontent-ai-usage-insights-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportUsageToJson = (environments: EnvironmentData[]) => {
    // Check if any environments have names in projectEnvMap (all environments mode)
    const hasEnvironmentNames = environments.some(env => projectEnvMap[env.environmentId]?.envName);
    const hasProjectInfo = environments.some(env => projectEnvMap[env.environmentId]?.project);
    
    // Sort environments by project name, then environment name (if available)
    const sortedEnvironments = [...environments].sort((a, b) => {
      const projectA = projectEnvMap[a.environmentId]?.project || '';
      const projectB = projectEnvMap[b.environmentId]?.project || '';
      if (projectA !== projectB) {
        return projectA.localeCompare(projectB);
      }
      const nameA = projectEnvMap[a.environmentId]?.envName || '';
      const nameB = projectEnvMap[b.environmentId]?.envName || '';
      return nameA.localeCompare(nameB);
    });
    
    let data: any;
    
    if (hasProjectInfo) {
      // Group by project for better organization
      const projectsMap: Record<string, { projectId: string; environments: any[] }> = {};
      
      sortedEnvironments.forEach(env => {
        const projectId = projectEnvMap[env.environmentId]?.projectId || '';
        
        if (!projectsMap[projectId]) {
          projectsMap[projectId] = {
            projectId,
            environments: []
          };
        }
        
        const envData: any = {
          environmentId: env.environmentId
        };
        
        if (hasEnvironmentNames) {
          envData.environmentName = projectEnvMap[env.environmentId]?.envName || env.name;
        }
        
        envData.metrics = {
          activeLanguages: env.metrics.languages,
          activeUsers: env.metrics.activeUsers,
          assetCount: env.metrics.assetCount,
          assetStorageMB: Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100,
          collections: env.metrics.collections,
          contentItemsAllLanguages: env.metrics.contentItems,
          contentTypes: env.metrics.contentTypes,
          customRoles: env.metrics.customRoles,
          spaces: env.metrics.spaces
        };
        
        projectsMap[projectId].environments.push(envData);
      });
      
      // Convert to array and sort by project name
      const projects = Object.values(projectsMap)
        .map(project => {
          // Get project name from first environment in this project
          const firstEnv = project.environments[0];
          const projectName = projectEnvMap[firstEnv.environmentId]?.project || 'Unknown Project';
          return {
            projectId: project.projectId,
            projectName,
            environments: project.environments
          };
        })
        .sort((a, b) => a.projectName.localeCompare(b.projectName));
      
      data = {
        generatedAt: new Date().toISOString(),
        projects
      };
    } else {
      // Flat structure for individual environments mode
      data = {
        generatedAt: new Date().toISOString(),
        environments: sortedEnvironments.map(env => {
          const envData: any = {
            environmentId: env.environmentId
          };
          // Only include name if we have environment names (all environments mode)
          if (hasEnvironmentNames) {
            envData.environmentName = projectEnvMap[env.environmentId]?.envName || env.name;
          }
          envData.metrics = {
            activeLanguages: env.metrics.languages,
            activeUsers: env.metrics.activeUsers,
            assetCount: env.metrics.assetCount,
            assetStorageMB: Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100,
            collections: env.metrics.collections,
            contentItemsAllLanguages: env.metrics.contentItems,
            contentTypes: env.metrics.contentTypes,
            customRoles: env.metrics.customRoles,
            spaces: env.metrics.spaces
          };
          return envData;
        })
      };
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kontent-ai-usage-insights-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportUsageToCsv = (environments: EnvironmentData[]) => {
    // Check if any environments have names in projectEnvMap (all environments mode)
    const hasEnvironmentNames = environments.some(env => projectEnvMap[env.environmentId]?.envName);
    const hasProjectInfo = environments.some(env => projectEnvMap[env.environmentId]?.project);
    
    // Sort environments by project name, then environment name (if available)
    const sortedEnvironments = [...environments].sort((a, b) => {
      const projectA = projectEnvMap[a.environmentId]?.project || '';
      const projectB = projectEnvMap[b.environmentId]?.project || '';
      if (projectA !== projectB) {
        return projectA.localeCompare(projectB);
      }
      const nameA = projectEnvMap[a.environmentId]?.envName || '';
      const nameB = projectEnvMap[b.environmentId]?.envName || '';
      return nameA.localeCompare(nameB);
    });
    
    const header = hasEnvironmentNames
      ? hasProjectInfo
        ? 'Project name,Environment name,Environment ID,Active languages,Active users,Asset count,Asset storage (MB),Collections,Content items (all languages),Content types,Custom roles,Spaces'
        : 'Environment ID,Environment name,Active languages,Active users,Asset count,Asset storage (MB),Collections,Content items (all languages),Content types,Custom roles,Spaces'
      : 'Environment ID,Active languages,Active users,Asset count,Asset storage (MB),Collections,Content items (all languages),Content types,Custom roles,Spaces';
    
    const csvData = [
      header,
      ...sortedEnvironments.map(env => {
        const projectName = projectEnvMap[env.environmentId]?.project || '';
        const envName = projectEnvMap[env.environmentId]?.envName || env.name;
        const metrics = [
          env.metrics.languages,
          env.metrics.activeUsers,
          env.metrics.assetCount,
          Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100,
          env.metrics.collections,
          env.metrics.contentItems,
          env.metrics.contentTypes,
          env.metrics.customRoles,
          env.metrics.spaces
        ];
        // Build row based on what columns we have
        let row;
        if (hasProjectInfo && hasEnvironmentNames) {
          row = [projectName, envName, env.environmentId, ...metrics];
        } else if (hasEnvironmentNames) {
          row = [env.environmentId, envName, ...metrics];
        } else {
          row = [env.environmentId, ...metrics];
        }
        return row.join(',');
      })
    ].join('\n');
    
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kontent-ai-usage-insights-${new Date().toISOString().split('T')[0]}.csv`;
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



  useEffect(() => {
    async function initializeSDK() {
      const loadingContainer = document.getElementById('loading-container') as HTMLElement;

      // DEBUG: Log environment info BEFORE iframe check
      console.log('App initialization - Environment check:', {
        isInIframe: window.self !== window.top,
        windowSelf: window.self,
        windowTop: window.top,
        location: window.location.href,
        parentOrigin: window.parent !== window ? document.referrer : 'N/A'
      });

      if (window.self !== window.top) {
        // Show loading immediately for custom app contexts to prevent flash
        if (loadingContainer) {
          setLoadingText('Checking for custom app context...');
          loadingContainer.style.display = 'flex';
        }
        
        try {
          console.log('Attempting to import SDK...');
          const SDK = await import('@kontent-ai/custom-app-sdk');
          console.log('SDK imported successfully:', SDK);
          console.log('SDK has observeCustomAppContext?', typeof (SDK as any).observeCustomAppContext);
          console.log('SDK has setPopupSize?', typeof (SDK as any).setPopupSize);
          
          // Subscribe to context changes
          console.log('Calling observeCustomAppContext...');
          const response = await (SDK as any).observeCustomAppContext(async (context: any) => {
            // DEBUG: Log the full context to understand what we're working with
            console.log('🎯 SDK Context callback invoked (context changed)!');
            console.log('SDK Context received:', {
              path: context.path,
              currentPage: context.currentPage,
              environmentId: context.environmentId
            });
            
            // Re-detect mode on context change by trying setPopupSize
            try {
              const popupResult = await (SDK as any).setPopupSize(
                { unit: 'px', value: 450 },
                { unit: '%', value: 70 }
              );
              
              if (popupResult.isError) {
                console.log('Context change: Full-screen mode');
                setIsDialogMode(false);
              } else {
                console.log('Context change: Dialog mode');
                setIsDialogMode(true);
              }
            } catch (err) {
              console.log('Context change: Full-screen mode (error)');
              setIsDialogMode(false);
            }
            
            // Handle environment ID from context
            if (context.environmentId) {
              setEnvironmentCredentials(prev => {
                const exists = prev.some(c => c.environmentId === context.environmentId);
                if (exists) return prev;
                if (appState.mode !== 'individual') return prev;
                
                // If we have an empty environment, replace it with the SDK environment
                if (prev.length === 1 && prev[0].environmentId === '') {
                  return [{
                    environmentId: context.environmentId,
                    deliveryApiKey: '',
                    managementApiKey: '',
                    subscriptionApiKey: '',
                    subscriptionId: ''
                  }];
                }
                
                // Otherwise, add a new environment
                return [...prev, {
                  environmentId: context.environmentId,
                  deliveryApiKey: '',
                  managementApiKey: '',
                  subscriptionApiKey: '',
                  subscriptionId: ''
                }];
              });
            }
          });
          
          console.log('observeCustomAppContext response received:', response);
          console.log('Response type:', typeof response);
          console.log('Response.isError:', response?.isError);
          console.log('Response.context:', response?.context);
          console.log('Response keys:', response ? Object.keys(response) : 'response is null/undefined');
          
          if (!response.isError) {
            console.log('✅ No error, setting SDK response with context:', response.context);
            setSdkResponse(response.context);
            
            // Process initial context immediately (callback is only for changes)
            const initialContext = response.context;
            console.log('Processing initial context:', initialContext);
            
            // Detect Dialog mode by trying to set popup size
            // If setPopupSize succeeds = Dialog mode (popup exists)
            // If setPopupSize fails = Full-screen mode (no popup)
            console.log('🔍 Attempting to detect mode by calling setPopupSize...');
            
            try {
              const popupResult = await (SDK as any).setPopupSize(
                { unit: 'px', value: 450 },
                { unit: '%', value: 70 }
              );
              
              if (popupResult.isError) {
                // setPopupSize failed = Full-screen mode
                console.log('❌ setPopupSize failed (Full-screen mode):', popupResult);
                setIsDialogMode(false);
              } else {
                // setPopupSize succeeded = Dialog mode
                console.log('✅ setPopupSize succeeded (Dialog mode)');
                setIsDialogMode(true);
              }
            } catch (err) {
              // Error calling setPopupSize = likely Full-screen mode
              console.log('❌ setPopupSize threw error (Full-screen mode):', err);
              setIsDialogMode(false);
            }
            
            console.log('Mode detection complete:', {
              currentPage: initialContext.currentPage,
              path: initialContext.path
            });
            
            // Handle environment ID from initial context
            if (initialContext.environmentId) {
              console.log('Setting environment ID from initial context:', initialContext.environmentId);
              setEnvironmentCredentials(prev => {
                const exists = prev.some(c => c.environmentId === initialContext.environmentId);
                if (exists) {
                  console.log('Environment already exists in credentials');
                  return prev;
                }
                if (appState.mode !== 'individual') {
                  console.log('Not in individual mode, skipping environment add');
                  return prev;
                }
                
                // If we have an empty environment, replace it with the SDK environment
                if (prev.length === 1 && prev[0].environmentId === '') {
                  console.log('Replacing empty environment with SDK environment');
                  return [{
                    environmentId: initialContext.environmentId,
                    deliveryApiKey: '',
                    managementApiKey: '',
                    subscriptionApiKey: '',
                    subscriptionId: ''
                  }];
                }
                
                // Otherwise, add a new environment
                console.log('Adding new environment from SDK context');
                return [...prev, {
                  environmentId: initialContext.environmentId,
                  deliveryApiKey: '',
                  managementApiKey: '',
                  subscriptionApiKey: '',
                  subscriptionId: ''
                }];
              });
            }
          } else {
            console.error('❌ SDK observeCustomAppContext returned error:', { 
              errorCode: response.code, 
              description: response.description
            });
          }
        } catch (error) {
          console.error('SDK initialization error:', error);
          console.error('Error details:', {
            name: (error as any)?.name,
            message: (error as any)?.message,
            stack: (error as any)?.stack
          });
        }
        
        // Hide loading when done
        if (loadingContainer) {
          loadingContainer.style.display = 'none';
        }
      }
      else {
        if (loadingContainer) {
          loadingContainer.style.display = 'none';
        }
        console.log('Running outside of Kontent.ai (not in iframe), SDK not loaded');
        console.log('If you expected SDK to load, the app may not be in an iframe context');
      }
      
    }

    initializeSDK();
  }, []);


    return (
    <>
      {['mode-selection','credentials','data-collection','results'].includes(appState.ui.currentStep) && (
        <div id='loading-container' className='basis-full fixed bg-white z-30 top-0 bottom-0 left-0 right-0 flex'>
          <div className='basis-full flex flex-col items-center justify-center'>
            <div
              id='loading-general-text'
              className='mb-3'
              style={{ textAlign: 'center' }}
              role='status'
              aria-live='polite'
            >
              {loadingText}
            </div>
            <span id='loading-general' className='loading-span text-6xl'></span>
          </div>
        </div>
      )}

      {showBackToTop && !isCollectingData && !isDialogMode && (
        <button
          type='button'
          aria-label='Back to top'
          onClick={handleBackToTop}
          className='fixed z-20 bottom-36 right-10 btn back-to-top-btn'
          style={{
            borderRadius: '9999px',
            width: '44px',
            height: '44px',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--purple)',
            color: 'white',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--darker-purple)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--purple)')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" />
          </svg>
        </button>
      )}
      <p id='app-title' className='text-white'>
        Usage Insights
      </p>

      {/* New Usage Insights UI */}
      {appState.ui.currentStep === 'mode-selection' && (
        <div className='basis-full flex flex-wrap place-content-start'>
          
          
          <div className='basis-full grid grid-cols-1 md:grid-cols-2 gap-6 mode-selection-grid'>
            <div 
              className='rounded-lg p-6 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(250,74,25)] focus-visible:ring-offset-2'
              style={{ backgroundColor: 'rgb(243, 243, 243)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'}
              onClick={() => handleModeSelection('individual')}
              role='button'
              tabIndex={0}
              aria-label='Select Individual environments mode'
              aria-pressed={appState.mode === 'individual'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleModeSelection('individual');
                }
              }}
            >
              <h3 className='text-lg font-semibold'>Individual environments</h3>
              <p className={`text-gray-600 ${isDialogMode ? 'mb-2' : 'mb-4'}`}>
                Analyze usage metrics for individually-added environments.
              </p>
              {isDialogMode ? (
                <details 
                  className='mode-card-details' 
                  onClick={(e) => e.stopPropagation()}
                  aria-label='Requirements for Individual environments mode'
                >
                  <summary 
                    className='text-sm font-semibold text-gray-500 cursor-pointer'
                    aria-label='View requirements for Individual environments mode'
                  >
                    Requirements
                  </summary>
                  <div className='text-sm text-gray-500 mt-1 pl-4' role='region' aria-label='Individual environments requirements list'>
                    <ul className='list-disc pl-4 text-sm space-y-1' role='list'>
                      <li className='text-gray-700'>Environment ID</li>
                      <li className='text-gray-700'>
                        At least one API key:
                        <ul className='list-[circle] pl-4 text-sm space-y-1 mt-1' role='list'>
                          <li className='text-gray-700'><span className='font-medium'>Delivery Preview</span> API key</li>
                          <li className='text-gray-700'><span className='font-medium'>Management</span> API key</li>
                          <li className='text-gray-700'><span className='font-medium'>Subscription</span> API key (requires Subscription ID)</li>
                        </ul>
                      </li>
                    </ul>
                  </div>
                </details>
              ) : (
                <div className='text-sm text-gray-500'>
                  <strong>Required:</strong>
                  <ul className='list-disc pl-6 text-sm space-y-1 mt-1'>
                    <li className='text-gray-700'>Environment ID</li>
                    <li className='text-gray-700'>
                      At least one API key:
                      <ul className='list-[circle] pl-6 text-sm space-y-1 mt-1'>
                        <li className='text-gray-700'><span className='font-medium'>Delivery Preview</span> API key</li>
                        <li className='text-gray-700'><span className='font-medium'>Management</span> API key</li>
                        <li className='text-gray-700'><span className='font-medium'>Subscription</span> API key (requires Subscription ID)</li>
                      </ul>
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div 
              className='rounded-lg p-6 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(250,74,25)] focus-visible:ring-offset-2'
              style={{ backgroundColor: 'rgb(243, 243, 243)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'}
              onClick={() => handleModeSelection('all')}
              role='button'
              tabIndex={0}
              aria-label='Select All environments mode'
              aria-pressed={appState.mode === 'all'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleModeSelection('all');
                }
              }}
            >
              <h3 className='text-lg font-semibold'>All environments</h3>
              <p className={`text-gray-600 ${isDialogMode ? 'mb-2' : 'mb-4'}`}>
                Analyze usage metrics across all environments in your subscription.
              </p>
              {isDialogMode ? (
                <details 
                  className='mode-card-details' 
                  onClick={(e) => e.stopPropagation()}
                  aria-label='Requirements for All environments mode'
                >
                  <summary 
                    className='text-sm font-semibold text-gray-500 cursor-pointer'
                    aria-label='View requirements for All environments mode'
                  >
                    Requirements
                  </summary>
                  <div className='text-sm text-gray-500 mt-1 pl-4' role='region' aria-label='All environments requirements list'>
                    <ul className='list-disc pl-4 text-sm space-y-1' role='list'>
                      <li className='text-gray-700'>Subscription ID</li>
                      <li className='text-gray-700'>Subscription API key</li>
                    </ul>
                    <strong className='mt-2 block'>Optional:</strong>
                    <ul className='list-disc pl-4 text-sm space-y-1 mt-1' role='list' aria-label='Optional credentials'>
                      <li className='text-gray-700'><span className='font-medium'>Delivery Preview</span> API keys</li>
                      <li className='text-gray-700'><span className='font-medium'>Management</span> API keys</li>
                    </ul>
                  </div>
                </details>
              ) : (
                <div className='text-sm text-gray-500'>
                  <strong>Required:</strong>
                  <ul className='list-disc pl-6 text-sm space-y-1 mt-1'>
                    <li className='text-gray-700'>Subscription ID</li>
                    <li className='text-gray-700'>Subscription API key</li>
                  </ul>
                  <strong className='mt-3 block'>Optional:</strong>
                  <ul className='list-disc pl-6 text-sm space-y-1 mt-1'>
                    <li className='text-gray-700'><span className='font-medium'>Delivery Preview</span> API keys</li>
                    <li className='text-gray-700'><span className='font-medium'>Management</span> API keys</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {appState.ui.currentStep === 'credentials' && (
        <div className="basis-full flex flex-col min-h-[calc(100vh-108px)]">
          <div className='basis-full'>
            <h2 className='text-xl font-bold mb-2'>
              {appState.mode === 'individual' ? 'Individual environments' : 'All environments'}
            </h2>
            <p className='text-gray-600 mb-4'>
              {appState.mode === 'individual' 
                ? 'Enter your environment credentials to analyze usage metrics.'
                : 'Enter your Subscription API credentials and environment API keys.'
              }
            </p>
          </div>

          {appState.mode === 'individual' && (
            <details className='mb-12'>
              <summary className='text-sm font-semibold text-left cursor-pointer bg-[rgb(243,243,243)]'>
                About keys and metrics
              </summary>
              <div className='rounded-b-lg px-4 pb-4 pt-2 text-left bg-[rgb(243,243,243)]'>
                <ul className='list-disc pl-6 space-y-1 text-sm text-gray-700'>
                  <li>
                    <span className='font-medium'>Delivery Preview API key</span>: Used for Delivery API requests. Provides counts for
                    content items, content types, and languages.
                  </li>
                  <li>
                    <span className='font-medium'>Management API key</span>: Used for Management API requests. Provides
                    asset metrics (asset count and Asset storage size) and collections.
                  </li>
                  <li>
                    <span className='font-medium'>Subscription ID + Subscription API key</span>: Used for Subscription API
                    requests. Provides active user counts per environment and loads
                    projects/environments in 'All environments' mode.
                  </li>
                </ul>
              </div>
            </details>
          )}

          {appState.mode === 'all' && (
            <details className='mb-6'>
              <summary className='text-sm font-semibold text-left cursor-pointer bg-[rgb(243,243,243)]'>
                About keys and metrics
              </summary>
              <div className='rounded-b-lg px-4 pb-4 pt-2 text-left bg-[rgb(243,243,243)]'>
                <ul className='list-disc pl-6 space-y-1 text-sm text-gray-700'>
                  <li>
                    <span className='font-medium'>Delivery Preview API key</span>: Used for Delivery API requests. Provides counts for
                    content items, content types, and languages.
                  </li>
                  <li>
                    <span className='font-medium'>Management API key</span>: Used for Management API requests. Provides
                    asset metrics (asset count and asset storage size) and collections.
                  </li>
                  <li>
                    <span className='font-medium'>Subscription ID + Subscription API key</span>: Used for Subscription API
                    requests. Provides active user counts per environment and loads
                    projects/environments in 'All environments' mode.
                  </li>
                </ul>
              </div>
            </details>
          )}

          {appState.mode === 'all' && (
            <div className='basis-full mb-12'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 stack-inputs'>
                <div className='relative'>
                  <label className='block text-base font-bold mb-2 flex items-center gap-1'>
                    Subscription ID<span style={{ color: 'var(--orange)' }}>*</span>
                    <span 
                      className='tooltip-icon tooltip-icon-small relative'
                      title={sdkResponse ? 'Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.' : 'Go to Kontent.ai -> Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.'}
                    >
                      ⓘ
                    </span>
                  </label>
                  <input
                    type='text'
                    value={subscriptionId}
                    onChange={(e) => setSubscriptionId(e.target.value)}
                    className='w-full px-3 py-2 border border-gray-300 rounded-md'
                    placeholder='Subscription ID'
                    aria-describedby='subscription-id-error subscription-id-tooltip'
                  />
                  <p id='subscription-id-error' className='hidden absolute bottom-10.5 left-[150px] inline-flex items-stretch rounded-lg overflow-hidden'>
                    <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                      <span className='error-icon'>⚠</span>
                    </span>
                    <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                      {subscriptionIdErrorText}
                    </span>
                  </p>
                </div>
                <div className='relative'>
                  <label className='block text-base font-bold mb-2 flex items-center gap-1'>
                    Subscription API key<span style={{ color: 'var(--orange)' }}>*</span>
                    <span 
                      className='tooltip-icon tooltip-icon-small relative'
                      title={sdkResponse ? 'Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.' : 'Go to Kontent.ai -> Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.'}
                    >
                      ⓘ
                    </span>
                  </label>
                  <input
                    type='password'
                    value={subscriptionApiKey}
                    onChange={(e) => setSubscriptionApiKey(e.target.value)}
                    className='w-full px-3 py-2 border border-gray-300 rounded-md'
                    placeholder='Subscription API key'
                    aria-describedby='subscription-api-key-error subscription-api-key-tooltip'
                  />
                  <p id='subscription-api-key-error' className='hidden absolute bottom-10.5 left-[190px] inline-flex items-stretch rounded-lg overflow-hidden'>
                    <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                      <span className='error-icon'>⚠</span>
                    </span>
                    <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                      {subscriptionApiKeyErrorText}
                    </span>
                  </p>
                </div>
              </div>
              <div className='mt-4 flex justify-end load-projects-btn-container'>
                <button
                  onClick={async () => {
                    if (!subscriptionId || !subscriptionApiKey) return;
                    if (!isValidUuidLength(subscriptionId)) return;
                    
                    setIsLoadingProjects(true);
                    
                    // Clear previous errors
                    setSubscriptionIdErrorText('');
                    setSubscriptionApiKeyErrorText('');
                    
                    // Hide error elements
                    const subscriptionIdError = document.getElementById('subscription-id-error') as HTMLElement;
                    const subscriptionApiKeyError = document.getElementById('subscription-api-key-error') as HTMLElement;
                    if (subscriptionIdError) subscriptionIdError.classList.add('hidden');
                    if (subscriptionApiKeyError) subscriptionApiKeyError.classList.add('hidden');
                    
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
                            setSubscriptionIdErrorText('Invalid Subscription ID. Please verify your Subscription ID and try again.');
                            if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                          } else if (res.error.includes('401')) {
                            setSubscriptionApiKeyErrorText('Invalid Subscription API key. Please verify your key and try again.');
                            if (subscriptionApiKeyError) {
                          subscriptionApiKeyError.classList.remove('hidden');
                          subscriptionApiKeyError.style.display = ''; // Clear any inline display style
                        }
                          } else {
                            setSubscriptionIdErrorText('Failed to load projects. Please verify your credentials and try again.');
                            if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                          }
                        } else if (res.error && typeof res.error === 'object') {
                          const errorCode = (res.error as any).status || (res.error as any).code;
                          if (errorCode === 400) {
                            setSubscriptionIdErrorText('Invalid Subscription ID. Please verify your Subscription ID and try again.');
                            if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                          } else if (errorCode === 401) {
                            setSubscriptionApiKeyErrorText('Invalid Subscription API key. Please verify your key and try again.');
                            if (subscriptionApiKeyError) {
                          subscriptionApiKeyError.classList.remove('hidden');
                          subscriptionApiKeyError.style.display = ''; // Clear any inline display style
                        }
    } else {
                            setSubscriptionIdErrorText('Failed to load projects. Please verify your credentials and try again.');
                            if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                          }
    } else {
                          setSubscriptionIdErrorText('Failed to load projects. Please verify your credentials and try again.');
                          if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                        }
                      }
                    } catch (e: any) {
                      console.error('Error loading projects:', e);
                      // Handle network or other errors
                      if (e?.response?.status === 400) {
                        setSubscriptionIdErrorText('Invalid Subscription ID. Please verify your Subscription ID and try again.');
                        if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                        setTimeout(scrollToFirstError, 0);
                      } else if (e?.response?.status === 401) {
                        setSubscriptionApiKeyErrorText('Invalid Subscription API key. Please verify your key and try again.');
                        if (subscriptionApiKeyError) {
                          subscriptionApiKeyError.classList.remove('hidden');
                          subscriptionApiKeyError.style.display = ''; // Clear any inline display style
                        }
                        setTimeout(scrollToFirstError, 0);
                      } else {
                        setSubscriptionIdErrorText('Failed to load projects. Please verify your credentials and try again.');
                        if (subscriptionIdError) {
                          subscriptionIdError.classList.remove('hidden');
                          subscriptionIdError.style.display = ''; // Clear any inline display style
                        }
                        setTimeout(scrollToFirstError, 0);
                      }
                    } finally {
                      setIsLoadingProjects(false);
                    }
                  }}
                  disabled={isLoadingProjects || !subscriptionId.trim() || !subscriptionApiKey.trim() || !isValidUuidLength(subscriptionId)}
                  className='btn continue-btn'
                >
                  {isLoadingProjects ? (
                    <>
                      <span className='loading-span' style={{ marginRight: '8px' }}></span>
                      Loading Projects & Environments...
                    </>
                  ) : (
                    'Load Projects & Environments'
                  )}
                </button>
              </div>
              {Object.keys(projectEnvMap).length > 0 && <hr className='assets-divider mt-12' />}
            </div>
          )}

          {(appState.mode === 'individual' || (appState.mode === 'all' && Object.keys(projectEnvMap).length > 0)) && (
            <div className='basis-full mb-6'>
              <div className='flex justify-between items-center mb-6'>
                <h3 className='text-lg font-semibold'>
                  {appState.mode === 'all' ? 'Projects & environments' : 'Environments'}
                </h3>
                <div className='flex items-center gap-2'>
                  <button 
                    onClick={collapseAllSections}
                    className='text-sm text-gray-500 hover:text-gray-700 cursor-pointer'
                  >
                    Collapse All
                  </button>
                  <span className='text-gray-400'>|</span>
                  <button 
                    onClick={expandAllSections}
                    className='text-sm text-gray-500 hover:text-gray-700 cursor-pointer'
                  >
                    Expand All
                  </button>
                </div>
              </div>


            {/* Group by project name if available */}
            {appState.mode === 'all' && Object.keys(projectEnvMap).length > 0 ? (
              // Group environments by project in All environments mode
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
                <details 
                  key={projectId} 
                  className='mb-6' 
                  open={expandedSections.has(`project-${projectId}`)}
                  onToggle={(e) => {
                    const isOpen = e.currentTarget.open;
                    setExpandedSections(prev => {
                      const newSet = new Set(prev);
                      if (isOpen) {
                        newSet.add(`project-${projectId}`);
                      } else {
                        newSet.delete(`project-${projectId}`);
                      }
                      return newSet;
                    });
                  }}
                >
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
                                    backgroundColor: 'transparent', 
                      color: 'var(--color-gray-500)',
                                    border: '1px solid var(--color-gray-300)',
                                    cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--lighter-red)';
                                    e.currentTarget.style.borderColor = 'var(--red)';
                                    e.currentTarget.style.color = 'var(--red)';
                                    const svg = e.currentTarget.querySelector('svg');
                                    if (svg) svg.style.color = 'var(--red)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                    e.currentTarget.style.borderColor = 'var(--color-gray-300)';
                                    e.currentTarget.style.color = 'var(--color-gray-500)';
                                    const svg = e.currentTarget.querySelector('svg');
                                    if (svg) svg.style.color = 'var(--color-gray-500)';
                                  }}
                                >
                                  <svg 
                                    xmlns="http://www.w3.org/2000/svg" 
                                    fill="none" 
                                    viewBox="0 0 24 24" 
                                    strokeWidth={1.5} 
                                    stroke="currentColor" 
                                    style={{ width: '24px', height: '24px', marginRight: '8px', color: 'var(--color-gray-500)' }}
                                  >
                                    <path 
                                      strokeLinecap="round" 
                                      strokeLinejoin="round" 
                                      d="M6 18 18 6M6 6l12 12" 
                                    />
                                  </svg>
                                  Remove
                                </button>
                              )}
                  </div>
                            <hr className='assets-divider within-container mb-6' />
                            <div className='grid grid-cols-1 md:grid-cols-2 gap-4 stack-inputs'>
                              <div className='relative'>
                                <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                                  Delivery Preview API key
                                  <span 
                                    className='tooltip-icon relative'
                                    style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                                    title={sdkResponse ? "To find your Delivery Preview API key, go to Project settings > API keys > Delivery API keys. Then, choose a Delivery API key with 'Content preview' selected in the 'Delivery API access' section." : "To find your Delivery Preview API key, go to Kontent.ai > Project settings > API keys > Delivery API keys. Then, choose a Delivery API key with 'Content preview' selected in the 'Delivery API access' section."}
                                  >
                                    ⓘ
                                  </span>
                  </label>
                                <input
                                  type='password'
                                  value={cred.deliveryApiKey || ''}
                                  onChange={(e) => updateEnvironmentCredential(originalIndex, 'deliveryApiKey', e.target.value)}
                                  className='w-full px-3 py-2 border border-gray-300 rounded-md'
                                  placeholder='Delivery Preview API key'
                                  aria-describedby={`api-key-error-env-${originalIndex}-delivery`}
                                  aria-invalid={!!apiKeyValidationErrors[`env-${originalIndex}-delivery`]}
                                />
                                <p id={`api-key-error-env-${originalIndex}-delivery`} className='hidden absolute bottom-10 left-[180px] inline-flex items-stretch rounded-lg overflow-hidden'>
                                  <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                                    <span className='error-icon'>⚠</span>
                                  </span>
                                  <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                                    {apiKeyValidationErrors[`env-${originalIndex}-delivery`]}
                                  </span>
                    </p>
                </div>
                              <div className={`relative ${creds.length === 1 ? 'mb-4' : ''}`}>
                                <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                                  Management API key
                                  <span 
                                    className='tooltip-icon relative'
                                    style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                                    title={sdkResponse ? "To find your Management API key, go to Project settings > API keys > Management API keys. Then, choose a Management API key with the 'Read content' permission selected in the 'Permissions' section." : "To find your Management API key, go to Kontent.ai > Project settings > API keys > Management API keys. Then, choose a Management API key with the 'Read content' permission selected in the 'Permissions' section."}
                                  >
                                    ⓘ
                                  </span>
                                </label>
                                <input
                                  type='password'
                                  value={cred.managementApiKey || ''}
                                  onChange={(e) => updateEnvironmentCredential(originalIndex, 'managementApiKey', e.target.value)}
                                  className='w-full px-3 py-2 border border-gray-300 rounded-md'
                                  placeholder='Management API key'
                                  aria-describedby={`api-key-error-env-${originalIndex}-management`}
                                  aria-invalid={!!apiKeyValidationErrors[`env-${originalIndex}-management`]}
                                />
                                <p id={`api-key-error-env-${originalIndex}-management`} className='hidden absolute bottom-10 left-[160px] inline-flex items-stretch rounded-lg overflow-hidden'>
                                  <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                                    <span className='error-icon'>⚠</span>
                                  </span>
                                  <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                                    {apiKeyValidationErrors[`env-${originalIndex}-management`]}
                                  </span>
                  </p>
                </div>
                            </div>
                            {creds.length > 1 && (
                              <div className='mt-4'>
                                <button
                                  type='button'
                                  onClick={() => applyKeysToSameProject(originalIndex)}
                                  className='btn back-btn'
                                >
                                  Apply to all environments
                </button>
                              </div>
              )}
            </div>
                        );
                      })}
              </div>
            </details>
                ));
              })()
            ) : (
              // Individual environments mode - show environments individually with expandable sections
              environmentCredentials.map((cred, index) => (
                <details 
                  key={index} 
                  className='mb-6' 
                  open={expandedSections.has(`env-${index}`)}
                  onToggle={(e) => {
                    const isOpen = e.currentTarget.open;
                    setExpandedSections(prev => {
                      const newSet = new Set(prev);
                      if (isOpen) {
                        newSet.add(`env-${index}`);
                      } else {
                        newSet.delete(`env-${index}`);
                      }
                      return newSet;
                    });
                  }}
                >
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
                            backgroundColor: 'transparent', 
                    color: 'var(--color-gray-500)',
                    border: '1px solid var(--color-gray-300)',
                            cursor: 'pointer',
                    display: 'flex',
                            alignItems: 'center'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--lighter-red)';
                            e.currentTarget.style.borderColor = 'var(--red)';
                            e.currentTarget.style.color = 'var(--red)';
                            const svg = e.currentTarget.querySelector('svg');
                            if (svg) svg.style.color = 'var(--red)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.borderColor = 'var(--color-gray-300)';
                            e.currentTarget.style.color = 'var(--color-gray-500)';
                            const svg = e.currentTarget.querySelector('svg');
                            if (svg) svg.style.color = 'var(--color-gray-500)';
                          }}
                        >
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            strokeWidth={1.5} 
                            stroke="currentColor" 
                            style={{ width: '24px', height: '24px', marginRight: '8px', color: 'var(--color-gray-500)' }}
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              d="M6 18 18 6M6 6l12 12" 
                            />
                          </svg>
                          Remove
                        </button>
                      )}
                  </div>
                  </summary>
                  <div className='rounded-b-lg px-6 pb-6 pt-4 bg-white border-l border-r border-b border-gray-200'>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 stack-inputs'>
                      <div>
                        <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                          Environment ID<span style={{ color: 'var(--orange)' }}>*</span>
                          <span 
                            className='tooltip-icon relative'
                            style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                            title={sdkResponse ? 'Select a project and its environment using the two drop-downs at the top left -> In Environment settings > General, click to copy the Environment ID to your clipboard.' : 'Go to Kontent.ai -> Select a project and its environment using the two drop-downs at the top left -> In Environment settings > General, click to copy the Environment ID to your clipboard.'}
                          >
                            ⓘ
                      </span>
                        </label>
                        <input
                          type='text'
                          value={cred.environmentId}
                          onChange={(e) => updateEnvironmentCredential(index, 'environmentId', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Environment ID'
                        />
                  </div>
                      <div className='relative'>
                        <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                          Delivery Preview API key
                              <span
                            className='tooltip-icon relative'
                            style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                            title={sdkResponse ? "To find your Delivery Preview API key, go to Project settings > API keys > Delivery API keys. Then, choose a Delivery API key with 'Content preview' selected in the 'Delivery API access' section." : "To find your Delivery Preview API key, go to Kontent.ai > Project settings > API keys > Delivery API keys. Then, choose a Delivery API key with 'Content preview' selected in the 'Delivery API access' section."}
                          >
                            ⓘ
                              </span>
                        </label>
                        <input
                          type='password'
                          value={cred.deliveryApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'deliveryApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Delivery Preview API key'
                          aria-describedby={`api-key-error-env-${index}-delivery`}
                          aria-invalid={!!apiKeyValidationErrors[`env-${index}-delivery`]}
                        />
                        <p id={`api-key-error-env-${index}-delivery`} className='hidden absolute bottom-10 left-[180px] inline-flex items-stretch rounded-lg overflow-hidden'>
                          <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                            <span className='error-icon'>⚠</span>
                          </span>
                          <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                            {apiKeyValidationErrors[`env-${index}-delivery`]}
                          </span>
                        </p>
                          </div>
                      <div className='relative'>
                        <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                          Management API key
                          <span 
                            className='tooltip-icon relative'
                            style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                            title={sdkResponse ? "To find your Management API key, go to Project settings > API keys > Management API keys. Then, choose a Management API key with the 'Read content' permission selected in the 'Permissions' section." : "To find your Management API key, go to Kontent.ai > Project settings > API keys > Management API keys. Then, choose a Management API key with the 'Read content' permission selected in the 'Permissions' section."}
                          >
                            ⓘ
                          </span>
                        </label>
                        <input
                          type='password'
                          value={cred.managementApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'managementApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Management API key'
                          aria-describedby={`api-key-error-env-${index}-management`}
                          aria-invalid={!!apiKeyValidationErrors[`env-${index}-management`]}
                        />
                        <p id={`api-key-error-env-${index}-management`} className='hidden absolute bottom-10 left-[160px] inline-flex items-stretch rounded-lg overflow-hidden'>
                          <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                            <span className='error-icon'>⚠</span>
                          </span>
                          <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                            {apiKeyValidationErrors[`env-${index}-management`]}
                          </span>
                        </p>
                  </div>
                      <div className='relative'>
                        <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                          Subscription ID
                          <span 
                            className='tooltip-icon relative'
                            style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                            title={sdkResponse ? 'Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.' : 'Go to Kontent.ai -> Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.'}
                          >
                            ⓘ
                          </span>
                        </label>
                    <input
                      type='text'
                          value={cred.subscriptionId || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'subscriptionId', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Subscription ID (required for Subscription API)'
                          aria-describedby={`api-key-error-env-${index}-subscription-id`}
                          aria-invalid={!!apiKeyValidationErrors[`env-${index}-subscription-id`]}
                        />
                        <p id={`api-key-error-env-${index}-subscription-id`} className='hidden absolute bottom-10 left-[128px] inline-flex items-stretch rounded-lg overflow-hidden'>
                          <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                            <span className='error-icon'>⚠</span>
                          </span>
                          <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                            {apiKeyValidationErrors[`env-${index}-subscription-id`]}
                          </span>
                        </p>
                  </div>
                      <div className='relative'>
                        <label className='block text-sm font-semibold mb-2 flex items-center gap-1'>
                          Subscription API key
                          <span 
                            className='tooltip-icon relative'
                            style={{ width: '16px', height: '16px', fontSize: '12px', marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' }}
                            title={sdkResponse ? 'Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.' : 'Go to Kontent.ai -> Click your initials in the bottom left corner -> Click Subscriptions -> Select the relevant subscription -> Click "Subscription API" from the left-hand navigation menu -> click "Copy to clipboard" for the Subscription ID and API key.'}
                          >
                            ⓘ
                          </span>
                        </label>
                    <input
                          type='password'
                          value={cred.subscriptionApiKey || ''}
                          onChange={(e) => updateEnvironmentCredential(index, 'subscriptionApiKey', e.target.value)}
                          className='w-full px-3 py-2 border border-gray-300 rounded-md'
                          placeholder='Subscription API key'
                          aria-describedby={`api-key-error-env-${index}-subscription`}
                          aria-invalid={!!apiKeyValidationErrors[`env-${index}-subscription`]}
                        />
                        <p id={`api-key-error-env-${index}-subscription`} className='hidden absolute bottom-10 left-[158px] inline-flex items-stretch rounded-lg overflow-hidden'>
                          <span className='bg-(--red) text-white px-2 py-[0.25rem] inline-flex items-center flex-shrink-0 message-icon-section'>
                            <span className='error-icon'>⚠</span>
                          </span>
                          <span className='bg-gray-100 text-black px-2 py-[0.25rem] inline-flex items-center text-xs'>
                            {apiKeyValidationErrors[`env-${index}-subscription`]}
                          </span>
                        </p>
                </div>
              </div>
                  </div>
                </details>
              ))
            )}

            {appState.mode === 'individual' && (
              <div 
                onClick={addEnvironmentCredential}
                className='rounded-lg p-4 mb-6 cursor-pointer transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(250,74,25)] focus-visible:ring-offset-2'
                style={{ backgroundColor: 'rgb(243, 243, 243)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgb(230, 230, 230)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgb(243, 243, 243)'; }}
                role='button'
                tabIndex={0}
                aria-label='Add environment'
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addEnvironmentCredential();
                  }
                }}
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
              <div
                id='validation-errors'
                className='mt-6 p-4 bg-red-50 border border-red-200 rounded-lg'
                role='alert'
                aria-live='assertive'
              >
                <h4 className='text-sm font-semibold text-red-800 mb-2'>Please fix the following issues:</h4>
                <ul className='text-sm text-red-700 space-y-1'>
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}
            </div>
          )}

          {/* Button container - always visible */}
          <div className={`flex items-center mt-auto button-container ${isDialogMode ? 'justify-center' : 'justify-between'} ${isDialogMode && appState.mode === 'all' && Object.keys(projectEnvMap).length === 0 ? 'with-divider' : ''}`}>
            <button
              onClick={() => setAppState(prev => ({ ...prev, ui: { ...prev.ui, currentStep: 'mode-selection' } }))}
              className='btn back-btn'
            >
              Change analysis mode
            </button>
            <button
              onClick={collectUsageData}
              disabled={
                isCollectingData || 
                (appState.mode === 'all' 
                  ? !subscriptionId.trim() || !subscriptionApiKey.trim() || !isValidUuidLength(subscriptionId) || Object.keys(projectEnvMap).length === 0
                  : environmentCredentials.length === 0 || !isFormValid())
              }
              className='btn continue-btn'
            >
              {isCollectingData ? 'Collecting Data...' : 'Collect Usage Data'}
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
        <div className='basis-full flex flex-col min-h-[calc(100vh-108px)]'>
          <div className='basis-full mb-6'>
            <div className='flex justify-between items-center'>
              <h2 className='text-xl font-bold'>Results</h2>
              <div className='relative' ref={exportDropdownRef}>
                      <button
                  ref={exportButtonRef}
                  onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                  className='btn continue-btn flex items-center gap-2'
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    strokeWidth={1.5} 
                    stroke="currentColor" 
                    style={{ width: '16px', height: '16px' }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                  Export
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    strokeWidth={1.5} 
                    stroke="currentColor" 
                    style={{ 
                      width: '16px', 
                      height: '16px',
                      transform: isExportDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease'
                    }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                          </button>
                {isExportDropdownOpen && (
                  <div 
                    className='absolute right-0 mt-2 bg-white border border-gray-300 rounded-lg z-50 overflow-hidden'
                    style={{ 
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                      borderColor: 'var(--color-gray-300)',
                      padding: '4px',
                      width: exportDropdownWidth ? `${exportDropdownWidth}px` : undefined
                    }}
                  >
                            <button
                      onClick={() => {
                        exportUsageReport('excel');
                        setIsExportDropdownOpen(false);
                      }}
                      className='w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-[rgb(243,243,243)] transition-colors cursor-pointer rounded'
                      style={{ fontSize: '14px' }}
                    >
                      Excel
                            </button>
                            <button
                      onClick={() => {
                        exportUsageReport('csv');
                        setIsExportDropdownOpen(false);
                      }}
                      className='w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-[rgb(243,243,243)] transition-colors cursor-pointer rounded'
                      style={{ fontSize: '14px' }}
                    >
                      CSV
                            </button>
                      <button
                      onClick={() => {
                        exportUsageReport('json');
                        setIsExportDropdownOpen(false);
                      }}
                      className='w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-[rgb(243,243,243)] transition-colors cursor-pointer rounded'
                      style={{ fontSize: '14px' }}
                    >
                      JSON
                      </button>
                  </div>
                  )}
                </div>
            </div>
          </div>

          <hr className='assets-divider mb-6' />
          <div className='basis-full flex-grow'>
            <div className='flex justify-between items-center mb-6'>
              <h3 className='text-lg font-semibold'>
                {appState.mode === 'all' ? 'Projects & environments' : 'Environments'}
              </h3>
              {appState.mode === 'all' && (
                <div className='flex items-center gap-2'>
                <button
                    onClick={collapseAllSections}
                    className='text-sm text-gray-500 hover:text-gray-700 cursor-pointer'
                  >
                    Collapse All
                  </button>
                  <span className='text-gray-400'>|</span>
                  <button 
                    onClick={expandAllSections}
                    className='text-sm text-gray-500 hover:text-gray-700 cursor-pointer'
                  >
                    Expand All
                </button>
                </div>
              )}
            </div>

            {/* Group environments by project if in all environments mode, otherwise show individually */}
            {appState.mode === 'all' && Object.keys(projectEnvMap).length > 0 ? (
              // Group environments by project in All environments mode
              (() => {
                const projectGroups: Record<string, { environments: EnvironmentData[], projectName: string }> = {};
                
                appState.data.environments.forEach((env) => {
                  const projectId = projectEnvMap[env.environmentId]?.projectId || 'unknown';
                  const projectName = projectEnvMap[env.environmentId]?.project || 'Unknown Project';
                  if (!projectGroups[projectId]) {
                    projectGroups[projectId] = { environments: [], projectName };
                  }
                  projectGroups[projectId].environments.push(env);
                });

                return Object.entries(projectGroups)
                  .sort(([, a], [, b]) => a.projectName.localeCompare(b.projectName))
                  .map(([projectId, { environments, projectName }]) => (
                    <details 
                      key={projectId} 
                      className='mb-6' 
                      open={expandedSections.has(`results-project-${projectId}`)}
                      onToggle={(e) => {
                        const isOpen = e.currentTarget.open;
                        setExpandedSections(prev => {
                          const newSet = new Set(prev);
                          if (isOpen) {
                            newSet.add(`results-project-${projectId}`);
                          } else {
                            newSet.delete(`results-project-${projectId}`);
                          }
                          return newSet;
                        });
                      }}
                    >
                      <summary className='text-lg font-bold text-gray-800 cursor-pointer bg-[rgb(243,243,243)] environment-summary'>
                        {projectName} ({environments.length} environment{environments.length !== 1 ? 's' : ''})
                      </summary>
                      <div className='rounded-b-lg px-4 pb-4 pt-2 bg-[rgb(243,243,243)]'>
                        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                          {environments.map((env) => (
                            <div key={env.environmentId} className='border border-gray-200 rounded-lg p-6 bg-white'>
                              <h4 className='text-base font-bold text-gray-800 mb-2'>
                                {projectEnvMap[env.environmentId]?.envName || 'Environment'}
                              </h4>
                              <div className='font-mono font-bold text-sm mb-4 break-all'>{env.environmentId}</div>
                              <div className='space-y-2'>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Active languages:</span>
                                  <span className='font-medium'>
                                    {formatMetricValue(env.metrics.languages, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                                  </span>
                                </div>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Active users:</span>
                                  <span className='font-medium'>
                                    {formatMetricValue(env.metrics.activeUsers, 'Subscription API key', env.apiKeysAvailable.subscription)}
                                  </span>
                                </div>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Asset count:</span>
                                  <span className='font-medium'>
                                    {formatMetricValue(env.metrics.assetCount, 'Management API key', env.apiKeysAvailable.management)}
                                  </span>
                                </div>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Asset storage:</span>
                                  <span className='font-medium'>
                                    {env.apiKeysAvailable.management ? (
                                      `${Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100} MB`
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
                                  <span className='text-gray-600'>Content items (all languages):</span>
                                  <span className='font-medium'>
                                    {formatMetricValue(env.metrics.contentItems, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                                  </span>
                                </div>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Content types:</span>
                                  <span className='font-medium'>
                                    {formatMetricValue(env.metrics.contentTypes, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                                  </span>
                                </div>
                                <div className='flex justify-between'>
                                  <span className='text-gray-600'>Custom roles:</span>
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
                              </div>
                            </div>
                          ))}
                        </div>
              </div>
            </details>
                  ));
              })()
            ) : (
              // Individual environments mode - show environments in responsive grid like original results
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                {appState.data.environments.map((env) => (
                  <div key={env.environmentId} className='border border-gray-200 rounded-lg p-6'>
                    <h3 className='text-sm font-medium text-gray-600'>Environment ID</h3>
                    <div className='font-mono font-bold text-sm mt-1 mb-4 break-all'>{env.environmentId}</div>
                    <div className='space-y-2'>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Active languages:</span>
                        <span className='font-medium'>
                          {formatMetricValue(env.metrics.languages, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Active users:</span>
                        <span className='font-medium'>
                          {formatMetricValue(env.metrics.activeUsers, 'Subscription API key', env.apiKeysAvailable.subscription)}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Asset count:</span>
                        <span className='font-medium'>
                          {formatMetricValue(env.metrics.assetCount, 'Management API key', env.apiKeysAvailable.management)}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Asset storage:</span>
                        <span className='font-medium'>
                          {env.apiKeysAvailable.management ? (
                          `${Math.round(env.metrics.assetStorageSize / 1000000 * 100) / 100} MB`
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
                        <span className='text-gray-600'>Content items (all languages):</span>
                        <span className='font-medium'>
                          {formatMetricValue(env.metrics.contentItems, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Content types:</span>
                        <span className='font-medium'>
                          {formatMetricValue(env.metrics.contentTypes, 'Delivery Preview API key', env.apiKeysAvailable.delivery)}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-gray-600'>Custom roles:</span>
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Button container - always visible at bottom */}
          <div className={`flex items-center mt-auto pt-12 button-container ${isDialogMode ? 'justify-center' : 'justify-between'}`}>
            <button
              onClick={() => {
                // Reset to mode selection
                setAppState(prev => ({ ...prev, ui: { ...prev.ui, currentStep: 'mode-selection' } }));
              }}
              className='btn back-btn'
            >
              Start New Analysis
            </button>
            <button
              onClick={collectUsageData}
              disabled={
                isCollectingData || 
                (appState.mode === 'all' 
                  ? !subscriptionId.trim() || !subscriptionApiKey.trim() || !isValidUuidLength(subscriptionId) || Object.keys(projectEnvMap).length === 0
                  : environmentCredentials.length === 0 || !isFormValid())
              }
              className='btn continue-btn'
            >
              {isCollectingData ? 'Collecting Data...' : 'Refresh Data'}
                </button>
          </div>
              </div>
            )}
    </>
  )
}

export default App