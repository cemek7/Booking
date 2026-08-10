export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import VerticalModuleManager from '../../../lib/verticalModuleManager';
import { z } from 'zod';

const VerticalSchema = z.enum(['beauty', 'hospitality', 'medicine']);

const GetModulesQuerySchema = z.object({
  vertical: VerticalSchema.optional(),
});

const ModuleActionSchema = z.enum(['install', 'uninstall', 'configure']);

const PostModulesBodySchema = z.object({
  action: ModuleActionSchema,
  moduleId: z.string(),
  configuration: z.unknown().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = GetModulesQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryValidation.success) {
      throw new Error(`Invalid query parameters: ${JSON.stringify(queryValidation.error.issues)}`);
    }
    const { vertical } = queryValidation.data;

    const moduleManager = new VerticalModuleManager(tenantId);

    if (vertical) {
      const modules = moduleManager.getModulesForVertical(vertical);
      return { success: true, modules };
    }

    const installedModules = moduleManager.getInstalledModules();
    const activeModules = moduleManager.getActiveModules();

    return {
      success: true,
      installed: installedModules,
      active: activeModules,
    };
  },
  'GET',
  { auth: true, roles: ['manager', 'owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const body = await ctx.request.json();
    const bodyValidation = PostModulesBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { action, moduleId, configuration } = bodyValidation.data;

    const moduleManager = new VerticalModuleManager(tenantId);
    let result;

    switch (action) {
      case 'install':
        result = await moduleManager.installModule(moduleId);
        break;
      case 'uninstall':
        result = await moduleManager.uninstallModule(moduleId);
        break;
      case 'configure':
        if (!configuration) {
          throw new Error('Configuration is required for configure action');
        }
        result = await moduleManager.configureModule(moduleId, configuration);
        break;
      default:
        throw new Error('Invalid action');
    }

    if (!result.success) {
      throw new Error(result.error || 'Module operation failed');
    }
    
    return { ...result, success: true };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
