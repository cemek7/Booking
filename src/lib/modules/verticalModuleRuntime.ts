import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface VerticalModule {
  id: string;
  name: string;
  vertical: 'beauty' | 'hospitality' | 'medicine' | 'general';
  version: string;
  status: 'active' | 'inactive' | 'deprecated';
  dependencies: string[];
  conflicts: string[];
  config_schema: Record<string, any>;
  default_config: Record<string, any>;
  features: string[];
  permissions: string[];
  templates: Record<string, any>;
  workflows: Record<string, any>;
  forms: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface TenantModuleConfig {
  id: string;
  tenant_id: string;
  module_id: string;
  module_name: string;
  status: 'installed' | 'uninstalled' | 'updating' | 'error' | 'installing';
  version: string;
  config: Record<string, any>;
  overrides: Record<string, any>;
  last_updated: string;
  installed_at: string;
  error_message?: string;
}

export interface ModuleInstallationResult {
  success: boolean;
  moduleId?: string;
  version?: string;
  error?: string;
  warnings?: string[];
  rollbackAvailable?: boolean;
}

class VerticalModuleRuntime {
  private supabase = createServerSupabaseClient();
  private installedModules = new Map<string, Map<string, any>>(); // tenant_id -> module_name -> module_instance
  private moduleSchemas = new Map<string, VerticalModule>();

  /**
   * Initialize the module runtime system
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Vertical Module Runtime...');

    try {
      // Load all available modules
      await this.loadAvailableModules();

      // Load tenant module configurations
      await this.loadTenantModules();

      console.log('✅ Vertical Module Runtime initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Module Runtime:', error);
      throw error;
    }
  }

  /**
   * Install module for a tenant
   */
  async installModule(
    tenantId: string,
    moduleName: string,
    config: Record<string, any> = {},
    version?: string
  ): Promise<ModuleInstallationResult> {
    console.log(`📦 Installing module ${moduleName} for tenant ${tenantId}`);

    try {
      // Get module definition
      const moduleSchema = this.moduleSchemas.get(moduleName);
      if (!moduleSchema) {
        return {
          success: false,
          error: `Module ${moduleName} not found in registry`
        };
      }

      // Check dependencies
      const dependencyCheck = await this.checkDependencies(tenantId, moduleSchema.dependencies);
      if (!dependencyCheck.satisfied) {
        return {
          success: false,
          error: `Missing dependencies: ${dependencyCheck.missing.join(', ')}`
        };
      }

      // Check conflicts
      const conflictCheck = await this.checkConflicts(tenantId, moduleSchema.conflicts);
      if (conflictCheck.hasConflicts) {
        return {
          success: false,
          error: `Module conflicts detected: ${conflictCheck.conflicts.join(', ')}`
        };
      }

      // Validate configuration
      const configValidation = await this.validateModuleConfig(moduleSchema, config);
      if (!configValidation.valid) {
        return {
          success: false,
          error: `Invalid configuration: ${configValidation.errors.join(', ')}`
        };
      }

      // Merge with default configuration
      const finalConfig = {
        ...moduleSchema.default_config,
        ...config
      };

      // Create installation record
      const installationRecord: Omit<TenantModuleConfig, 'id'> = {
        tenant_id: tenantId,
        module_id: moduleSchema.id,
        module_name: moduleName,
        status: 'installing',
        version: version || moduleSchema.version,
        config: finalConfig,
        overrides: {},
        last_updated: new Date().toISOString(),
        installed_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('tenant_modules')
        .insert(installationRecord)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: `Database error: ${error.message}`
        };
      }

      // Install module components
      const installationResult = await this.performModuleInstallation(
        tenantId,
        moduleSchema,
        finalConfig
      );

      if (!installationResult.success) {
        // Rollback on failure
        await this.rollbackInstallation(tenantId, moduleName);
        return installationResult;
      }

      // Update status to installed
      await this.supabase
        .from('tenant_modules')
        .update({
          status: 'installed',
          last_updated: new Date().toISOString()
        })
        .eq('id', data.id);

      // Load module into runtime
      await this.loadModuleIntoRuntime(tenantId, moduleSchema, finalConfig);

      console.log(`✅ Module ${moduleName} installed successfully for tenant ${tenantId}`);

      return {
        success: true,
        moduleId: moduleSchema.id,
        version: moduleSchema.version,
        warnings: installationResult.warnings
      };

    } catch (error) {
      console.error(`Error installing module ${moduleName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Installation failed'
      };
    }
  }

  /**
   * Uninstall module for a tenant
   */
  async uninstallModule(
    tenantId: string,
    moduleName: string,
    options: { force?: boolean; cleanup?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`🗑️ Uninstalling module ${moduleName} for tenant ${tenantId}`);

    try {
      // Check if other modules depend on this one
      if (!options.force) {
        const dependents = await this.findDependentModules(tenantId, moduleName);
        if (dependents.length > 0) {
          return {
            success: false,
            error: `Cannot uninstall: Required by ${dependents.join(', ')}`
          };
        }
      }

      // Remove from runtime
      const tenantModules = this.installedModules.get(tenantId);
      if (tenantModules) {
        tenantModules.delete(moduleName);
      }

      // Perform cleanup if requested
      if (options.cleanup) {
        await this.cleanupModuleData(tenantId, moduleName);
      }

      // Update database
      await this.supabase
        .from('tenant_modules')
        .update({
          status: 'uninstalled',
          last_updated: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('module_name', moduleName);

      console.log(`✅ Module ${moduleName} uninstalled for tenant ${tenantId}`);

      return { success: true };

    } catch (error) {
      console.error(`Error uninstalling module ${moduleName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Uninstallation failed'
      };
    }
  }

  /**
   * Update module configuration for a tenant
   */
  async updateModuleConfig(
    tenantId: string,
    moduleName: string,
    newConfig: Record<string, any>,
    overrides: Record<string, any> = {}
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`⚙️ Updating config for module ${moduleName} in tenant ${tenantId}`);

    try {
      // Get current module installation
      const { data: installation, error } = await this.supabase
        .from('tenant_modules')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('module_name', moduleName)
        .eq('status', 'installed')
        .single();

      if (error || !installation) {
        return {
          success: false,
          error: 'Module not found or not installed'
        };
      }

      // Get module schema for validation
      const moduleSchema = this.moduleSchemas.get(moduleName);
      if (!moduleSchema) {
        return {
          success: false,
          error: 'Module schema not found'
        };
      }

      // Validate new configuration
      const configValidation = await this.validateModuleConfig(moduleSchema, newConfig);
      if (!configValidation.valid) {
        return {
          success: false,
          error: `Invalid configuration: ${configValidation.errors.join(', ')}`
        };
      }

      // Update configuration
      const updatedConfig = {
        ...installation.config,
        ...newConfig
      };

      await this.supabase
        .from('tenant_modules')
        .update({
          config: updatedConfig,
          overrides: {
            ...installation.overrides,
            ...overrides
          },
          last_updated: new Date().toISOString()
        })
        .eq('id', installation.id);

      // Reload module with new config
      await this.reloadModule(tenantId, moduleName, updatedConfig);

      return { success: true };

    } catch (error) {
      console.error(`Error updating module config:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Config update failed'
      };
    }
  }

  /**
   * Get module instance for a tenant
   */
  getModuleInstance(tenantId: string, moduleName: string): any | null {
    const tenantModules = this.installedModules.get(tenantId);
    return tenantModules?.get(moduleName) || null;
  }

  /**
   * Execute module workflow
   */
  async executeWorkflow(
    tenantId: string,
    moduleName: string,
    workflowName: string,
    context: Record<string, any>
  ): Promise<{
    success: boolean;
    result?: any;
    error?: string;
    nextStep?: string;
  }> {
    try {
      const moduleInstance = this.getModuleInstance(tenantId, moduleName);
      if (!moduleInstance) {
        return {
          success: false,
          error: `Module ${moduleName} not found or not installed`
        };
      }

      const workflow = moduleInstance.workflows?.[workflowName];
      if (!workflow) {
        return {
          success: false,
          error: `Workflow ${workflowName} not found in module ${moduleName}`
        };
      }

      // Execute workflow steps
      const result = await this.executeWorkflowSteps(workflow, context);

      return {
        success: true,
        result: result.output,
        nextStep: result.nextStep
      };

    } catch (error) {
      console.error(`Error executing workflow ${workflowName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Workflow execution failed'
      };
    }
  }

  /**
   * Render module form
   */
  async renderForm(
    tenantId: string,
    moduleName: string,
    formName: string,
    data: Record<string, any> = {}
  ): Promise<{
    success: boolean;
    formSchema?: any;
    formData?: any;
    error?: string;
  }> {
    try {
      const moduleInstance = this.getModuleInstance(tenantId, moduleName);
      if (!moduleInstance) {
        return {
          success: false,
          error: `Module ${moduleName} not found or not installed`
        };
      }

      const formSchema = moduleInstance.forms?.[formName];
      if (!formSchema) {
        return {
          success: false,
          error: `Form ${formName} not found in module ${moduleName}`
        };
      }

      // Process form schema with tenant-specific data
      const processedSchema = await this.processFormSchema(formSchema, tenantId, data);

      return {
        success: true,
        formSchema: processedSchema,
        formData: data
      };

    } catch (error) {
      console.error(`Error rendering form ${formName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Form rendering failed'
      };
    }
  }

  /**
   * Get tenant modules
   */
  async getTenantModules(tenantId: string): Promise<TenantModuleConfig[]> {
    try {
      const { data, error } = await this.supabase
        .from('tenant_modules')
        .select(`
          *,
          modules!inner(
            name,
            vertical,
            version,
            features,
            description
          )
        `)
        .eq('tenant_id', tenantId)
        .in('status', ['installed', 'updating'])
        .order('installed_at', { ascending: false });

      if (error) {
        console.error('Error fetching tenant modules:', error);
        return [];
      }

      return data as TenantModuleConfig[];
    } catch (error) {
      console.error('Error getting tenant modules:', error);
      return [];
    }
  }

  /**
   * Get available modules for vertical
   */
  async getAvailableModules(vertical?: string): Promise<VerticalModule[]> {
    try {
      let query = this.supabase
        .from('modules')
        .select('*')
        .eq('status', 'active');

      if (vertical) {
        query = query.in('vertical', [vertical, 'general']);
      }

      const { data, error } = await query.order('name');

      if (error) {
        console.error('Error fetching available modules:', error);
        return [];
      }

      return data as VerticalModule[];
    } catch (error) {
      console.error('Error getting available modules:', error);
      return [];
    }
  }

  // Private helper methods

  /**
   * Load available modules from database
   */
  private async loadAvailableModules(): Promise<void> {
    const modules = await this.getAvailableModules();
    
    for (const module of modules) {
      this.moduleSchemas.set(module.name, module);
    }

    console.log(`📚 Loaded ${modules.length} available modules`);
  }

  /**
   * Load tenant module configurations
   */
  private async loadTenantModules(): Promise<void> {
    try {
      const { data: tenantModules, error } = await this.supabase
        .from('tenant_modules')
        .select(`
          *,
          modules!inner(*)
        `)
        .eq('status', 'installed');

      if (error) {
        console.error('Error loading tenant modules:', error);
        return;
      }

      // Group by tenant and load into runtime
      const tenantGroups = tenantModules.reduce((groups: Record<string, any[]>, tm: any) => {
        if (!groups[tm.tenant_id]) {
          groups[tm.tenant_id] = [];
        }
        groups[tm.tenant_id].push(tm);
        return groups;
      }, {} as Record<string, any[]>);

      for (const [tenantId, modules] of Object.entries(tenantGroups)) {
        for (const moduleConfig of modules) {
          await this.loadModuleIntoRuntime(
            tenantId,
            moduleConfig.modules,
            moduleConfig.config
          );
        }
      }

      console.log(`🔧 Loaded modules for ${Object.keys(tenantGroups).length} tenants`);
    } catch (error) {
      console.error('Error loading tenant modules:', error);
    }
  }

  /**
   * Check module dependencies
   */
  private async checkDependencies(
    tenantId: string,
    dependencies: string[]
  ): Promise<{ satisfied: boolean; missing: string[] }> {
    if (dependencies.length === 0) {
      return { satisfied: true, missing: [] };
    }

    const { data: installedModules } = await this.supabase
      .from('tenant_modules')
      .select('module_name')
      .eq('tenant_id', tenantId)
      .eq('status', 'installed');

    const installedNames = new Set(installedModules?.map((m: any) => m.module_name) || []);
    const missing = dependencies.filter(dep => !installedNames.has(dep));

    return {
      satisfied: missing.length === 0,
      missing
    };
  }

  /**
   * Check module conflicts
   */
  private async checkConflicts(
    tenantId: string,
    conflicts: string[]
  ): Promise<{ hasConflicts: boolean; conflicts: string[] }> {
    if (conflicts.length === 0) {
      return { hasConflicts: false, conflicts: [] };
    }

    const { data: installedModules } = await this.supabase
      .from('tenant_modules')
      .select('module_name')
      .eq('tenant_id', tenantId)
      .eq('status', 'installed');

    const installedNames = new Set(installedModules?.map((m: any) => m.module_name) || []);
    const foundConflicts = conflicts.filter(conflict => installedNames.has(conflict));

    return {
      hasConflicts: foundConflicts.length > 0,
      conflicts: foundConflicts
    };
  }

  /**
   * Validate module configuration
   */
  private async validateModuleConfig(
    moduleSchema: VerticalModule,
    config: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Basic JSON schema validation would go here
      // For now, just check required fields
      const schema = moduleSchema.config_schema;
      const required = schema.required || [];

      for (const field of required) {
        if (!(field in config)) {
          errors.push(`Required field missing: ${field}`);
        }
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      errors.push('Schema validation failed');
      return { valid: false, errors };
    }
  }

  /**
   * Perform actual module installation
   */
  private async performModuleInstallation(
    tenantId: string,
    moduleSchema: VerticalModule,
    config: Record<string, any>
  ): Promise<{ success: boolean; warnings?: string[] }> {
    const warnings: string[] = [];

    try {
      // Install templates
      if (moduleSchema.templates) {
        for (const [templateName, template] of Object.entries(moduleSchema.templates)) {
          // Install template logic would go here
          console.log(`Installing template: ${templateName}`);
        }
      }

      // Install workflows
      if (moduleSchema.workflows) {
        for (const [workflowName, workflow] of Object.entries(moduleSchema.workflows)) {
          // Install workflow logic would go here
          console.log(`Installing workflow: ${workflowName}`);
        }
      }

      // Install forms
      if (moduleSchema.forms) {
        for (const [formName, form] of Object.entries(moduleSchema.forms)) {
          // Install form logic would go here
          console.log(`Installing form: ${formName}`);
        }
      }

      return { success: true, warnings };

    } catch (error) {
      console.error('Module installation failed:', error);
      return { success: false };
    }
  }

  /**
   * Load module into runtime
   */
  private async loadModuleIntoRuntime(
    tenantId: string,
    moduleSchema: VerticalModule,
    config: Record<string, any>
  ): Promise<void> {
    try {
      if (!this.installedModules.has(tenantId)) {
        this.installedModules.set(tenantId, new Map());
      }

      const moduleInstance = {
        schema: moduleSchema,
        config,
        templates: moduleSchema.templates,
        workflows: moduleSchema.workflows,
        forms: moduleSchema.forms,
        features: moduleSchema.features,
        loadedAt: new Date().toISOString()
      };

      this.installedModules.get(tenantId)!.set(moduleSchema.name, moduleInstance);
      console.log(`✅ Loaded module ${moduleSchema.name} for tenant ${tenantId}`);

    } catch (error) {
      console.error(`Error loading module ${moduleSchema.name} into runtime:`, error);
    }
  }

  /**
   * Execute workflow steps
   */
  private async executeWorkflowSteps(
    workflow: any,
    context: Record<string, any>
  ): Promise<{ output: any; nextStep?: string }> {
    // Simplified workflow execution
    // In production, this would be a full workflow engine
    try {
      const steps = workflow.steps || [];
      let currentContext = { ...context };
      let output = null;

      for (const step of steps) {
        switch (step.type) {
          case 'form':
            output = { form: step.form, data: currentContext };
            break;
          case 'validation':
            // Validation logic
            break;
          case 'booking':
            // Booking creation logic
            break;
          case 'notification':
            // Notification sending logic
            break;
          default:
            console.warn(`Unknown workflow step type: ${step.type}`);
        }

        if (step.updateContext) {
          currentContext = { ...currentContext, ...step.updateContext };
        }
      }

      return { output, nextStep: workflow.nextStep };

    } catch (error) {
      console.error('Workflow execution error:', error);
      throw error;
    }
  }

  /**
   * Process form schema with tenant data
   */
  private async processFormSchema(
    formSchema: any,
    tenantId: string,
    data: Record<string, any>
  ): Promise<any> {
    try {
      // Clone schema
      const processed = JSON.parse(JSON.stringify(formSchema));

      // Apply tenant-specific customizations
      // This would include things like:
      // - Loading tenant-specific options
      // - Applying tenant branding
      // - Setting default values based on tenant config

      return processed;

    } catch (error) {
      console.error('Error processing form schema:', error);
      throw error;
    }
  }

  /**
   * Find modules that depend on this one
   */
  private async findDependentModules(tenantId: string, moduleName: string): Promise<string[]> {
    try {
      const { data: tenantModules } = await this.supabase
        .from('tenant_modules')
        .select(`
          module_name,
          modules!inner(dependencies)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'installed');

      const dependents: string[] = [];

      for (const tm of tenantModules || []) {
        const dependencies = tm.modules?.dependencies || [];
        if (dependencies.includes(moduleName)) {
          dependents.push(tm.module_name);
        }
      }

      return dependents;

    } catch (error) {
      console.error('Error finding dependent modules:', error);
      return [];
    }
  }

  /**
   * Cleanup module data
   */
  private async cleanupModuleData(tenantId: string, moduleName: string): Promise<void> {
    try {
      // This would clean up module-specific data
      // - Remove templates
      // - Clean up workflow data
      // - Remove form submissions
      console.log(`🧹 Cleaning up data for module ${moduleName} in tenant ${tenantId}`);

    } catch (error) {
      console.error('Error cleaning up module data:', error);
    }
  }

  /**
   * Rollback installation
   */
  private async rollbackInstallation(tenantId: string, moduleName: string): Promise<void> {
    try {
      console.log(`⚠️ Rolling back installation of ${moduleName} for tenant ${tenantId}`);

      // Remove installation record
      await this.supabase
        .from('tenant_modules')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('module_name', moduleName)
        .eq('status', 'installing');

      // Clean up any partially installed components
      await this.cleanupModuleData(tenantId, moduleName);

    } catch (error) {
      console.error('Error during rollback:', error);
    }
  }

  /**
   * Reload module with new configuration
   */
  private async reloadModule(
    tenantId: string,
    moduleName: string,
    newConfig: Record<string, any>
  ): Promise<void> {
    try {
      // Remove from runtime
      const tenantModules = this.installedModules.get(tenantId);
      if (tenantModules?.has(moduleName)) {
        const moduleSchema = tenantModules.get(moduleName).schema;
        
        // Reload with new config
        await this.loadModuleIntoRuntime(tenantId, moduleSchema, newConfig);
      }

    } catch (error) {
      console.error('Error reloading module:', error);
    }
  }
}

// Export singleton instance
export const verticalModuleRuntime = new VerticalModuleRuntime();