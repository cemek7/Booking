/**
 * Vertical Module System
 * Modular architecture for Beauty, Hospitality, and Medicine verticals
 */

export interface VerticalModule {
  id: string;
  name: string;
  version: string;
  description: string;
  vertical: 'beauty' | 'hospitality' | 'medicine';
  dependencies: string[];
  components: Record<string, unknown>;
  workflows: Record<string, unknown>;
  features: VerticalFeature[];
  configuration: VerticalConfig;
  isActive: boolean;
  installDate?: string;
  lastUpdated?: string;
}

export interface VerticalFeature {
  id: string;
  name: string;
  description: string;
  component: string;
  permissions: string[];
  configurable: boolean;
  dependencies: string[];
}

export interface VerticalConfig {
  customFields: Record<string, unknown>;
  workflows: Record<string, unknown>;
  integrations: Record<string, unknown>;
  ui: {
    theme?: string;
    branding?: Record<string, unknown>;
    layout?: string;
  };
  business: {
    timezone: string;
    currency: string;
    tax_rate?: number;
    booking_rules: Record<string, unknown>;
  };
}

export interface VerticalRegistry {
  modules: Record<string, VerticalModule>;
  installed: string[];
  active: string[];
  configurations: Record<string, VerticalConfig>;
}

export class VerticalModuleManager {
  private registry: VerticalRegistry;
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.registry = {
      modules: {},
      installed: [],
      active: [],
      configurations: {},
    };
    this.initializeDefaultModules();
  }

  /**
   * Initialize default vertical modules
   */
  private initializeDefaultModules(): void {
    // Beauty Vertical Module
    this.registry.modules['beauty-salon'] = {
      id: 'beauty-salon',
      name: 'Beauty Salon Suite',
      version: '1.0.0',
      description: 'Complete beauty salon management with styling, treatments, and client care',
      vertical: 'beauty',
      dependencies: ['core-booking', 'payment-system'],
      components: {
        ServiceCatalog: 'BeautyServiceCatalog',
        BookingFlow: 'BeautyBookingFlow',
        ClientProfile: 'BeautyClientProfile',
        StaffSchedule: 'BeautyStylistSchedule',
        InventoryManager: 'BeautyInventoryManager',
        LoyaltyProgram: 'BeautyLoyaltyProgram',
      },
      workflows: {
        consultation: 'beauty-consultation-flow',
        treatment: 'beauty-treatment-flow',
        aftercare: 'beauty-aftercare-flow',
        product_recommendation: 'beauty-product-recommendation',
      },
      features: [
        {
          id: 'stylist-portfolio',
          name: 'Stylist Portfolio',
          description: 'Showcase stylist work and specializations',
          component: 'StylistPortfolio',
          permissions: ['view_staff', 'manage_portfolio'],
          configurable: true,
          dependencies: ['media-upload'],
        },
        {
          id: 'before-after-gallery',
          name: 'Before/After Gallery',
          description: 'Client transformation gallery',
          component: 'TransformationGallery',
          permissions: ['view_gallery', 'upload_photos'],
          configurable: true,
          dependencies: ['media-upload', 'client-consent'],
        },
        {
          id: 'product-inventory',
          name: 'Beauty Product Inventory',
          description: 'Track beauty products and supplies',
          component: 'BeautyInventory',
          permissions: ['manage_inventory', 'view_stock'],
          configurable: true,
          dependencies: [],
        },
        {
          id: 'loyalty-points',
          name: 'Beauty Loyalty Program',
          description: 'Points-based loyalty system for beauty services',
          component: 'BeautyLoyalty',
          permissions: ['manage_loyalty', 'view_points'],
          configurable: true,
          dependencies: ['payment-system'],
        },
      ],
      configuration: {
        customFields: {
          hair_type: ['straight', 'wavy', 'curly', 'coily'],
          skin_type: ['oily', 'dry', 'combination', 'sensitive'],
          allergies: 'text',
          preferred_products: 'array',
        },
        workflows: {
          consultation_required: true,
          before_after_photos: true,
          product_recommendations: true,
          aftercare_instructions: true,
        },
        integrations: {
          product_catalog: 'enabled',
          social_media_sharing: 'optional',
          email_marketing: 'enabled',
        },
        ui: {
          theme: 'beauty-elegant',
          branding: {
            primary_color: '#ff6b9d',
            accent_color: '#ffd93d',
          },
          layout: 'grid',
        },
        business: {
          timezone: 'UTC',
          currency: 'USD',
          tax_rate: 8.5,
          booking_rules: {
            advance_booking_days: 14,
            cancellation_hours: 24,
            consultation_duration: 15,
            treatment_buffer: 15,
          },
        },
      },
      isActive: false,
    };

    // Hospitality Vertical Module
    this.registry.modules['hospitality-suite'] = {
      id: 'hospitality-suite',
      name: 'Hospitality Management Suite',
      version: '1.0.0',
      description: 'Complete hospitality management for hotels, restaurants, and event spaces',
      vertical: 'hospitality',
      dependencies: ['core-booking', 'payment-system', 'calendar-system'],
      components: {
        RoomManagement: 'HospitalityRoomManager',
        EventBooking: 'HospitalityEventBooking',
        GuestServices: 'HospitalityGuestServices',
        FoodBeverage: 'HospitalityFnB',
        HousekeepingSchedule: 'HospitalityHousekeeping',
        ConciergeServices: 'HospitalityConcierge',
      },
      workflows: {
        checkin: 'hospitality-checkin-flow',
        checkout: 'hospitality-checkout-flow',
        room_service: 'hospitality-room-service-flow',
        event_planning: 'hospitality-event-planning-flow',
      },
      features: [
        {
          id: 'room-management',
          name: 'Room & Accommodation Management',
          description: 'Manage rooms, suites, and accommodation inventory',
          component: 'RoomInventory',
          permissions: ['manage_rooms', 'view_occupancy'],
          configurable: true,
          dependencies: ['calendar-system'],
        },
        {
          id: 'guest-preferences',
          name: 'Guest Preference System',
          description: 'Track and apply guest preferences and special requests',
          component: 'GuestPreferences',
          permissions: ['view_guests', 'manage_preferences'],
          configurable: true,
          dependencies: [],
        },
        {
          id: 'upsell-engine',
          name: 'Revenue Optimization Engine',
          description: 'Automated upselling and cross-selling opportunities',
          component: 'RevenueOptimizer',
          permissions: ['manage_pricing', 'view_analytics'],
          configurable: true,
          dependencies: ['analytics-system'],
        },
        {
          id: 'group-bookings',
          name: 'Group Booking Management',
          description: 'Handle group reservations and event bookings',
          component: 'GroupBookingManager',
          permissions: ['manage_groups', 'view_events'],
          configurable: true,
          dependencies: ['calendar-system'],
        },
      ],
      configuration: {
        customFields: {
          room_type: ['standard', 'deluxe', 'suite', 'penthouse'],
          meal_plan: ['room_only', 'breakfast', 'half_board', 'full_board'],
          special_requests: 'text',
          loyalty_tier: ['basic', 'silver', 'gold', 'platinum'],
        },
        workflows: {
          automated_checkin: true,
          mobile_key: true,
          concierge_chat: true,
          upselling_enabled: true,
        },
        integrations: {
          property_management: 'enabled',
          restaurant_pos: 'optional',
          spa_booking: 'optional',
          transport_services: 'enabled',
        },
        ui: {
          theme: 'hospitality-luxury',
          branding: {
            primary_color: '#2c3e50',
            accent_color: '#f39c12',
          },
          layout: 'dashboard',
        },
        business: {
          timezone: 'UTC',
          currency: 'USD',
          tax_rate: 12.5,
          booking_rules: {
            advance_booking_days: 365,
            cancellation_hours: 48,
            checkin_time: '15:00',
            checkout_time: '11:00',
          },
        },
      },
      isActive: false,
    };

    // Medicine Vertical Module
    this.registry.modules['medical-practice'] = {
      id: 'medical-practice',
      name: 'Medical Practice Management',
      version: '1.0.0',
      description: 'HIPAA-compliant medical practice management system',
      vertical: 'medicine',
      dependencies: ['core-booking', 'security-system', 'compliance-system'],
      components: {
        PatientRecords: 'MedicalPatientRecords',
        AppointmentScheduling: 'MedicalAppointmentSystem',
        PractitionerSchedule: 'MedicalPractitionerSchedule',
        HealthRecords: 'MedicalHealthRecords',
        Prescriptions: 'MedicalPrescriptionManager',
        ComplianceMonitor: 'MedicalComplianceMonitor',
      },
      workflows: {
        patient_intake: 'medical-intake-flow',
        appointment: 'medical-appointment-flow',
        follow_up: 'medical-followup-flow',
        prescription: 'medical-prescription-flow',
      },
      features: [
        {
          id: 'patient-portal',
          name: 'Patient Portal',
          description: 'Secure patient portal for appointments and records',
          component: 'PatientPortal',
          permissions: ['view_own_records', 'book_appointments'],
          configurable: true,
          dependencies: ['security-system'],
        },
        {
          id: 'telemedicine',
          name: 'Telemedicine Integration',
          description: 'Virtual consultation capabilities',
          component: 'TelemedicineSystem',
          permissions: ['conduct_teleconsults', 'view_sessions'],
          configurable: true,
          dependencies: ['video-system', 'security-system'],
        },
        {
          id: 'prescription-management',
          name: 'Electronic Prescriptions',
          description: 'Digital prescription management and tracking',
          component: 'PrescriptionManager',
          permissions: ['prescribe_medication', 'view_prescriptions'],
          configurable: true,
          dependencies: ['compliance-system'],
        },
        {
          id: 'health-tracking',
          name: 'Health Metrics Tracking',
          description: 'Track patient health metrics and vitals',
          component: 'HealthTracker',
          permissions: ['view_health_data', 'update_vitals'],
          configurable: true,
          dependencies: [],
        },
      ],
      configuration: {
        customFields: {
          medical_history: 'encrypted_text',
          allergies: 'encrypted_array',
          medications: 'encrypted_array',
          insurance_info: 'encrypted_object',
        },
        workflows: {
          hipaa_compliance: true,
          appointment_reminders: true,
          follow_up_required: true,
          prescription_tracking: true,
        },
        integrations: {
          ehr_system: 'required',
          pharmacy_network: 'optional',
          lab_results: 'optional',
          insurance_verification: 'enabled',
        },
        ui: {
          theme: 'medical-clean',
          branding: {
            primary_color: '#0066cc',
            accent_color: '#28a745',
          },
          layout: 'clinical',
        },
        business: {
          timezone: 'UTC',
          currency: 'USD',
          tax_rate: 0, // Medical services often tax-exempt
          booking_rules: {
            advance_booking_days: 90,
            cancellation_hours: 24,
            appointment_duration: 30,
            buffer_time: 10,
          },
        },
      },
      isActive: false,
    };
  }

  /**
   * Get available modules for a vertical
   */
  getModulesForVertical(vertical: 'beauty' | 'hospitality' | 'medicine'): VerticalModule[] {
    return Object.values(this.registry.modules).filter(module => module.vertical === vertical);
  }

  /**
   * Install a vertical module
   */
  async installModule(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const moduleConfig = this.registry.modules[moduleId];
      if (!moduleConfig) {
        return { success: false, error: 'Module not found' };
      }

      // Check dependencies
      for (const dependency of moduleConfig.dependencies) {
        if (!this.isDependencyMet(dependency)) {
          return { success: false, error: `Missing dependency: ${dependency}` };
        }
      }

      // Install module
      moduleConfig.isActive = true;
      moduleConfig.installDate = new Date().toISOString();
      
      if (!this.registry.installed.includes(moduleId)) {
        this.registry.installed.push(moduleId);
      }
      
      if (!this.registry.active.includes(moduleId)) {
        this.registry.active.push(moduleId);
      }

      // Apply default configuration
      this.registry.configurations[moduleId] = { ...moduleConfig.configuration };

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Uninstall a vertical module
   */
  async uninstallModule(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const moduleConfig = this.registry.modules[moduleId];
      if (!moduleConfig) {
        return { success: false, error: 'Module not found' };
      }

      // Check if other modules depend on this one
      const dependents = this.findDependentModules(moduleId);
      if (dependents.length > 0) {
        return { 
          success: false, 
          error: `Cannot uninstall: Required by ${dependents.join(', ')}` 
        };
      }

      // Uninstall module
      moduleConfig.isActive = false;
      this.registry.active = this.registry.active.filter(id => id !== moduleId);
      this.registry.installed = this.registry.installed.filter(id => id !== moduleId);
      delete this.registry.configurations[moduleId];

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Configure a vertical module
   */
  async configureModule(
    moduleId: string, 
    configuration: Partial<VerticalConfig>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const moduleConfig = this.registry.modules[moduleId];
      if (!moduleConfig || !moduleConfig.isActive) {
        return { success: false, error: 'Module not found or not active' };
      }

      // Merge configuration
      this.registry.configurations[moduleId] = {
        ...this.registry.configurations[moduleId],
        ...configuration,
      };

      moduleConfig.lastUpdated = new Date().toISOString();

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get module configuration
   */
  getModuleConfiguration(moduleId: string): VerticalConfig | null {
    return this.registry.configurations[moduleId] || null;
  }

  /**
   * Get all installed modules
   */
  getInstalledModules(): VerticalModule[] {
    return this.registry.installed
      .map(id => this.registry.modules[id])
      .filter(Boolean);
  }

  /**
   * Get all active modules
   */
  getActiveModules(): VerticalModule[] {
    return this.registry.active
      .map(id => this.registry.modules[id])
      .filter(Boolean);
  }

  /**
   * Check if module dependency is met
   */
  private isDependencyMet(dependency: string): boolean {
    // Check if it's a core system dependency (always available)
    const coreModules = ['core-booking', 'payment-system', 'calendar-system', 'security-system', 'compliance-system'];
    if (coreModules.includes(dependency)) {
      return true;
    }

    // Check if it's an installed module
    return this.registry.active.includes(dependency);
  }

  /**
   * Find modules that depend on a given module
   */
  private findDependentModules(moduleId: string): string[] {
    return this.registry.active.filter(activeId => {
      const activeModule = this.registry.modules[activeId];
      return activeModule && activeModule.dependencies.includes(moduleId);
    });
  }

  /**
   * Get module registry for export/import
   */
  exportRegistry(): VerticalRegistry {
    return { ...this.registry };
  }

  /**
   * Import module registry
   */
  importRegistry(registry: VerticalRegistry): void {
    this.registry = registry;
  }
}

export default VerticalModuleManager;