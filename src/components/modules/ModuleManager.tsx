import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Download, 
  Upload, 
  Settings, 
  Trash2, 
  Play, 
  Pause, 
  RefreshCw,
  Package,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cpu
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { verticalModuleRuntime, VerticalModule, TenantModuleConfig } from '@/lib/modules/verticalModuleRuntime';

interface ModuleManagerProps {
  tenantId: string;
  vertical: 'beauty' | 'hospitality' | 'medicine' | 'general';
}

export default function ModuleManager({ tenantId, vertical }: ModuleManagerProps) {
  const [availableModules, setAvailableModules] = useState<VerticalModule[]>([]);
  const [installedModules, setInstalledModules] = useState<TenantModuleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<VerticalModule | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [moduleConfig, setModuleConfig] = useState<Record<string, any>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadModules();
  }, [tenantId, vertical]);

  const loadModules = async () => {
    setLoading(true);
    try {
      await verticalModuleRuntime.initialize();

      const [available, installed] = await Promise.all([
        verticalModuleRuntime.getAvailableModules(vertical),
        verticalModuleRuntime.getTenantModules(tenantId)
      ]);

      setAvailableModules(available);
      setInstalledModules(installed);
    } catch (error) {
      console.error('Error loading modules:', error);
      toast({
        title: 'Error',
        description: 'Failed to load modules',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInstallModule = async (module: VerticalModule, config: Record<string, any>) => {
    setInstalling(module.id);
    
    try {
      const result = await verticalModuleRuntime.installModule(
        tenantId,
        module.name,
        config
      );

      if (result.success) {
        toast({
          title: 'Success',
          description: `Module ${module.name} installed successfully`
        });

        if (result.warnings && result.warnings.length > 0) {
          toast({
            title: 'Warnings',
            description: result.warnings.join(', '),
            variant: 'default'
          });
        }

        await loadModules();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Installation error:', error);
      toast({
        title: 'Installation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setInstalling(null);
      setInstallDialogOpen(false);
    }
  };

  const handleUninstallModule = async (moduleName: string) => {
    try {
      const result = await verticalModuleRuntime.uninstallModule(
        tenantId,
        moduleName,
        { cleanup: true }
      );

      if (result.success) {
        toast({
          title: 'Success',
          description: `Module ${moduleName} uninstalled successfully`
        });
        await loadModules();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Uninstall error:', error);
      toast({
        title: 'Uninstall Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };

  const handleUpdateConfig = async (moduleName: string, newConfig: Record<string, any>) => {
    try {
      const result = await verticalModuleRuntime.updateModuleConfig(
        tenantId,
        moduleName,
        newConfig
      );

      if (result.success) {
        toast({
          title: 'Success',
          description: `Module ${moduleName} configuration updated`
        });
        await loadModules();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Config update error:', error);
      toast({
        title: 'Update Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
    setConfigDialogOpen(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'installed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'installing':
      case 'updating':
        return <Clock className="h-4 w-4 text-yellow-500 animate-spin" />;
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Package className="h-4 w-4 text-gray-500" />;
    }
  };

  const getVerticalBadgeColor = (moduleVertical: string) => {
    switch (moduleVertical) {
      case 'beauty':
        return 'bg-pink-100 text-pink-800';
      case 'hospitality':
        return 'bg-blue-100 text-blue-800';
      case 'medicine':
        return 'bg-green-100 text-green-800';
      case 'general':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span>Loading modules...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Runtime Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Cpu className="h-5 w-5" />
            <span>Module Runtime Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-gray-600">Runtime: Active</span>
            </div>
            <div className="flex items-center space-x-2">
              <Package className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-gray-600">
                Installed: {installedModules.length} modules
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Download className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-gray-600">
                Available: {availableModules.length} modules
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Installed Modules */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Installed Modules</span>
              <Button
                size="sm"
                variant="outline"
                onClick={loadModules}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {installedModules.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No modules installed</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {installedModules.map((module) => (
                    <Card key={module.id} className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(module.status)}
                            <span className="font-medium">{module.module_name}</span>
                            <Badge 
                              variant="secondary" 
                              className={getVerticalBadgeColor(module.modules?.vertical || 'general')}
                            >
                              {module.modules?.vertical || 'general'}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500 space-y-1">
                            <div>Version: {module.version}</div>
                            <div>Installed: {new Date(module.installed_at).toLocaleDateString()}</div>
                            {module.error_message && (
                              <div className="text-red-500">Error: {module.error_message}</div>
                            )}
                          </div>
                          {module.modules?.features && (
                            <div className="flex flex-wrap gap-1">
                              {module.modules.features.slice(0, 3).map((feature, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {feature}
                                </Badge>
                              ))}
                              {module.modules.features.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{module.modules.features.length - 3} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedModule(availableModules.find(m => m.name === module.module_name) || null);
                              setModuleConfig(module.config || {});
                              setConfigDialogOpen(true);
                            }}
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUninstallModule(module.module_name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Available Modules */}
        <Card>
          <CardHeader>
            <CardTitle>Available Modules</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {availableModules.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No modules available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableModules.map((module) => {
                    const isInstalled = installedModules.some(
                      im => im.module_name === module.name && im.status === 'installed'
                    );
                    const isInstalling = installing === module.id;

                    return (
                      <Card key={module.id} className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">{module.name}</span>
                              <Badge 
                                variant="secondary" 
                                className={getVerticalBadgeColor(module.vertical)}
                              >
                                {module.vertical}
                              </Badge>
                              {isInstalled && (
                                <Badge variant="default" className="bg-green-100 text-green-800">
                                  Installed
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 space-y-1">
                              <div>Version: {module.version}</div>
                              <div>Dependencies: {module.dependencies.length}</div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {module.features.slice(0, 3).map((feature, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {feature}
                                </Badge>
                              ))}
                              {module.features.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{module.features.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex space-x-1">
                            {!isInstalled && (
                              <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
                                <DialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    disabled={isInstalling}
                                    onClick={() => {
                                      setSelectedModule(module);
                                      setModuleConfig(module.default_config || {});
                                    }}
                                  >
                                    {isInstalling ? (
                                      <>
                                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                        Installing...
                                      </>
                                    ) : (
                                      <>
                                        <Download className="h-4 w-4 mr-2" />
                                        Install
                                      </>
                                    )}
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Install Module: {selectedModule?.name}</DialogTitle>
                                    <DialogDescription>
                                      Configure the module settings before installation
                                    </DialogDescription>
                                  </DialogHeader>

                                  <div className="space-y-4">
                                    {selectedModule?.config_schema && (
                                      <div className="space-y-3">
                                        {Object.entries(selectedModule.config_schema.properties || {}).map(([key, schema]: [string, any]) => (
                                          <div key={key}>
                                            <Label htmlFor={key}>{schema.title || key}</Label>
                                            {schema.type === 'string' && (
                                              <Input
                                                id={key}
                                                value={moduleConfig[key] || ''}
                                                onChange={(e) => setModuleConfig({
                                                  ...moduleConfig,
                                                  [key]: e.target.value
                                                })}
                                                placeholder={schema.description}
                                              />
                                            )}
                                            {schema.type === 'boolean' && (
                                              <Switch
                                                checked={moduleConfig[key] || false}
                                                onCheckedChange={(checked) => setModuleConfig({
                                                  ...moduleConfig,
                                                  [key]: checked
                                                })}
                                              />
                                            )}
                                            {schema.description && (
                                              <p className="text-xs text-gray-500">{schema.description}</p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <DialogFooter>
                                    <Button
                                      variant="outline"
                                      onClick={() => setInstallDialogOpen(false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      onClick={() => selectedModule && handleInstallModule(selectedModule, moduleConfig)}
                                      disabled={isInstalling}
                                    >
                                      {isInstalling ? (
                                        <>
                                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                          Installing...
                                        </>
                                      ) : (
                                        'Install Module'
                                      )}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure Module: {selectedModule?.name}</DialogTitle>
            <DialogDescription>
              Update the module configuration
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {selectedModule?.config_schema && (
              <div className="space-y-3">
                {Object.entries(selectedModule.config_schema.properties || {}).map(([key, schema]: [string, any]) => (
                  <div key={key}>
                    <Label htmlFor={key}>{schema.title || key}</Label>
                    {schema.type === 'string' && (
                      <Input
                        id={key}
                        value={moduleConfig[key] || ''}
                        onChange={(e) => setModuleConfig({
                          ...moduleConfig,
                          [key]: e.target.value
                        })}
                        placeholder={schema.description}
                      />
                    )}
                    {schema.type === 'boolean' && (
                      <Switch
                        checked={moduleConfig[key] || false}
                        onCheckedChange={(checked) => setModuleConfig({
                          ...moduleConfig,
                          [key]: checked
                        })}
                      />
                    )}
                    {schema.description && (
                      <p className="text-xs text-gray-500">{schema.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfigDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedModule && handleUpdateConfig(selectedModule.name, moduleConfig)}
            >
              Update Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}