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

import { AddCommand, ModelServerCommand, RemoveCommand, SetCommand } from '@eclipse-emfcloud/modelserver-client';
import { CommandProvider, Logger, Transaction } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';

/**
 * A registry of command providers from _Model Server_ plug-ins.
 */
@injectable()
export class CommandProviderRegistry {
    @inject(Logger)
    @named(CommandProviderRegistry.name)
    protected readonly logger: Logger;

    protected providers: Map<string, CommandProvider[]> = new Map();

    protected readonly primitiveCommandTypes = new Set([AddCommand.TYPE, RemoveCommand.TYPE, SetCommand.TYPE]);

    /**
     * Register a command provider for a custom command, by type.
     *
     * @param commandType the custom command type for which to register a command provider
     * @param provider the command provider(s) to register
     *
     * @throws if the `commandType` is one of the primitive add, set, or remove types
     */
    register(commandType: string, ...provider: CommandProvider[]): void {
        this.logger.debug(`Registering custom ${commandType} command provider`);

        if (this.primitiveCommandTypes.has(commandType)) {
            throw new Error(`Attempt to register custom command provider for primitive ${commandType} command`);
        }

        const existing = this.getProviders(commandType);
        this.providers.set(commandType, existing.concat(provider));
    }

    /**
     * Unregister a previously registered custom command provider.
     * Has no effect if the provider is not currently registered for the given command type.
     *
     * @param commandType the command type from which to unregister a provider
     * @param provider the command provider(s) to unregister
     */
    unregister(commandType: string, ...provider: CommandProvider[]): void {
        if (this.providers.has(commandType)) {
            const existing = this.providers.get(commandType);
            const updated = existing.filter(item => !provider.includes(item));
            if (updated.length > 0) {
                this.providers.set(commandType, updated);
            } else {
                this.providers.delete(commandType);
            }
        }
    }

    hasProvider(commandType: string): boolean {
        return this.providers.has(commandType);
    }

    getProviders(commandType: string): CommandProvider[] {
        return this.providers.get(commandType) || [];
    }

    getProvider(command: ModelServerCommand): CommandProvider | undefined {
        this.logger.debug(`Looking up provider for custom ${command.type} command`);
        return this.getProviders(command.type).find(p => p.canHandle(command));
    }

    /**
     * Obtain the commands to forward to the _Upstream Model Server_ to implement the given custom command.
     *
     * @param modelUri the URI of the model being edited.
     * @param customCommand get the commands provided for a given custom command
     * @returns the provided command, command transaction, or the original `customCommand` standing in for itself
     *    if no provider can handle the custom command
     */
    async getCommands(modelUri: string, customCommand: ModelServerCommand): Promise<ModelServerCommand | Operation[] | Transaction> {
        let result: ModelServerCommand | Operation[] | Transaction | undefined;
        const provider = this.getProvider(customCommand);
        if (provider) {
            this.logger.debug(`Invoking provider for custom ${customCommand.type} command`);
            result = await provider.getCommands(modelUri, customCommand);

            if (!result) {
                this.logger.warn(`No commands provided. Custom ${customCommand.type} command will be unhandled.`);
            }

            return result;
        }

        // If no commands are provided, the custom stands for itself
        return customCommand;
    }
}
