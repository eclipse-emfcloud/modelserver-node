/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/

import {
    CommandProvider,
    Logger,
    ModelServerPlugin,
    ModelServerPluginContext,
    Registration,
    ValidationProvider,
    ValidationProviderRegistrationOptions
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, multiInject, named } from 'inversify';

import { CommandProviderRegistry } from './command-provider-registry';
import { ValidationProviderRegistry } from './validation-provider-registry';

interface InitializationResult {
    name: string;
    result: boolean;
}

export const InternalModelServerPluginContext = Symbol('InternalModelServerPluginContext');

/**
 * Internal interface for the plug-in context that provides API for the server
 * side of the plug-in framework.
 */
export interface InternalModelServerPluginContext extends ModelServerPluginContext {
    /** Initialize the registered plug-ins. */
    initializePlugins(): Promise<unknown>;
}

/**
 * Default implementation of the _Model Server_'s plug-in context API.
 */
@injectable()
export class BasicModelServerPluginContext implements InternalModelServerPluginContext {
    @inject(Logger)
    @named(BasicModelServerPluginContext.name)
    protected readonly logger: Logger;

    @inject(CommandProviderRegistry)
    protected commandProviderRegistry: CommandProviderRegistry;

    @inject(ValidationProviderRegistry)
    protected validationProviderRegistry: ValidationProviderRegistry;

    @multiInject(ModelServerPlugin)
    protected plugins: ModelServerPlugin[];

    async initializePlugins(): Promise<unknown> {
        const initializer: (plugin: ModelServerPlugin) => Promise<InitializationResult> = this.initializePlugin.bind(this);

        return Promise.all(this.plugins.filter(plugin => plugin.initialize).map(initializer)).then(results =>
            results.filter(r => !r.result).forEach(r => this.reportFailedInit(r.name))
        );
    }

    registerCommandProvider(commandType: string, provider: CommandProvider): Registration<string, CommandProvider> {
        this.commandProviderRegistry.register(commandType, provider);
        return {
            key: commandType,
            service: provider,
            unregister: () => this.commandProviderRegistry.unregister(commandType, provider)
        };
    }

    registerValidationProvider(
        provider: ValidationProvider,
        options?: ValidationProviderRegistrationOptions
    ): Registration<string, ValidationProvider> {
        const key = this.validationProviderRegistry.register(provider, options);
        return {
            key,
            service: provider,
            unregister: () => this.validationProviderRegistry.unregister(key, provider)
        };
    }

    private async initializePlugin(plugin: ModelServerPlugin): Promise<InitializationResult> {
        const name = plugin.constructor.name;
        this.logger.info('Initializing plug-in %s.', name);

        try {
            const result = await plugin.initialize!(this);
            return { name, result };
        } catch (e) {
            this.logger.error(e);
            return { name, result: false };
        }
    }

    private reportFailedInit(pluginName: string): void {
        this.logger.warn('Plug-in "%s" initialization failed. It is removed from the system.', pluginName);
    }
}
