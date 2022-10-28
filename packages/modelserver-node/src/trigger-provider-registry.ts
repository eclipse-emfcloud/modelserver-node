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

import { Executor, Logger, Transaction, TriggerProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';
import { v4 as uuid } from 'uuid';

/**
 * A registry of trigger providers from _Model Server_ plug-ins.
 */
@injectable()
export class TriggerProviderRegistry {
    @inject(Logger)
    @named(TriggerProviderRegistry.name)
    protected readonly logger: Logger;

    protected providers: Map<string, TriggerProvider> = new Map();

    /**
     * Register a trigger provider.
     *
     * @param provider the trigger provider to register
     * @returns the unique ID of the registered `provider`
     */
    register(provider: TriggerProvider): string {
        const id = uuid();
        this.logger.debug(`Registering trigger provider ${id}`);

        this.providers.set(id, provider);
        return id;
    }

    /**
     * Unregister a previously registered trigger provider.
     * Has no effect if the provider is not currently registered.
     *
     * @param id the unique ID of the provider to unregister
     * @param provider the trigger provider to unregister
     */
    unregister(id: string, provider: TriggerProvider): void {
        if (this.providers.has(id)) {
            const registered = this.providers.get(id);
            if (registered === provider) {
                this.providers.delete(id);
            }
        }
    }

    /**
     * Query whether any trigger providers are registered.
     */
    hasProviders(): boolean {
        return this.providers.size > 0;
    }

    getProviders(modelURI: URI, patch: Operation[]): TriggerProvider[] {
        this.logger.debug('Looking up trigger providers for JSON Patch');
        const result: TriggerProvider[] = [];
        for (const provider of this.providers.values()) {
            if (provider.canTrigger(modelURI, patch)) {
                result.push(provider);
            }
        }
        return result;
    }

    /**
     * Gets a trigger provider that aggregates all triggers provided for the given `patch`.
     *
     * @param modelURI the URI of the model for which the `patch` describes changes
     * @param path a JSON Patch describing the model changes triggering side-effects
     * @returns an aggregate trigger provider, or `undefined` if no registered providers
     *    respond to the `patch`
     */
    getProvider(modelURI: URI, patch: Operation[]): TriggerProvider | undefined {
        const providers = this.getProviders(modelURI, patch);
        switch (providers.length) {
            case 0:
                return undefined;
            case 1:
                return providers[0];
            default:
                return multiTriggerProvider(providers);
        }
    }

    /**
     * Obtain additional edits to forward to the _Model Server_ that are triggered by the given `patch`.
     *
     * @param modelURI the URI of the model for which the `patch` describes changes
     * @param patch the JSON Patch on which to trigger further changes
     * @returns the provided trigger patch or transaction, if any
     */
    async getTriggers(modelURI: URI, patch: Operation[]): Promise<Operation[] | Transaction | undefined> {
        let result: Operation[] | Transaction | undefined;
        const provider = this.getProvider(modelURI, patch);
        if (provider) {
            this.logger.debug('Invoking trigger provider(s)');
            result = await provider.getTriggers(modelURI, patch);

            return result;
        }

        // No triggered edits to perform
        return undefined;
    }
}

/**
 * Aggregate multiple trigger providers into one.
 *
 * @param triggerProviders an array of multiple trigger providers
 * @returns the aggregate trigger provider
 */
function multiTriggerProvider(triggerProviders: TriggerProvider[]): TriggerProvider {
    return {
        canTrigger: () => true,
        getTriggers: (modelURI: URI, modelDelta: Operation[]) => async (executor: Executor) => {
            let result = true;

            for (const provider of triggerProviders) {
                const provided = await provider.getTriggers(modelURI, modelDelta);
                if (typeof provided === 'function') {
                    result = await provided(executor);

                    // If any trigger transaction balks, then roll everything back
                    if (!result) {
                        break;
                    }
                } else if (provided.length) {
                    result = (await executor.applyPatch(provided)).success;
                }
            }

            return result;
        }
    };
}
