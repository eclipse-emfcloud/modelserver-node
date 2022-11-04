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

import { Diagnostic, ModelServerObjectV2, OK } from '@eclipse-emfcloud/modelserver-client';
import { Logger, ValidationProvider, ValidationProviderRegistrationOptions } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';
import { v4 as uuid } from 'uuid';

type ValidationProviderFilter = (model: ModelServerObjectV2, modelURI: string) => boolean;

export type Validator = (model: ModelServerObjectV2, modelURI: URI) => Promise<Diagnostic>;

/**
 * A registry of validation providers from _Model Server_ plug-ins.
 */
@injectable()
export class ValidationProviderRegistry {
    @inject(Logger)
    @named(ValidationProviderRegistry.name)
    protected readonly logger: Logger;

    protected providers: Map<string, { provider: ValidationProvider; filter: ValidationProviderFilter }> = new Map();

    /**
     * Register a validation provider.
     *
     * @param commandType the custom command type for which to register a command provider
     * @param provider the command provider(s) to register
     */
    register(provider: ValidationProvider, options?: ValidationProviderRegistrationOptions): string {
        const id = uuid();
        this.logger.debug(`Registering custom validation provider ${id}`);

        const matchModelObject = createModelTypeFilter(options?.modelType);
        const matchModelURI = createModelURIFilter(options?.modelURI);

        this.providers.set(id, {
            provider,
            filter: (model, modelURI) => matchModelObject(model) && matchModelURI(modelURI)
        });

        return id;
    }

    /**
     * Unregister a previously registered custom validation provider.
     * Has no effect if the provider is not currently registered under the given ID.
     *
     * @param id the validation provider ID
     * @param provider the validation provider to unregister
     */
    unregister(id: string, provider: ValidationProvider): void {
        if (this.providers.has(id)) {
            const registered = this.providers.get(id);
            if (registered.provider === provider) {
                this.providers.delete(id);
            }
        }
    }

    hasProvider(model: ModelServerObjectV2, modelURI: string): boolean {
        for (const next of this.providers.values()) {
            if (next.filter(model, modelURI)) {
                return true;
            }
        }
        return false;
    }

    getProviders(model: ModelServerObjectV2, modelURI: URI): ValidationProvider[] {
        const result: ValidationProvider[] = [];
        this.providers.forEach(next => {
            if (next.filter(model, modelURI.toString())) {
                result.push(next.provider);
            }
        });
        return result;
    }

    getValidator(model: ModelServerObjectV2, modelURI: URI): Validator | undefined {
        this.logger.debug(`Looking up provider for validation of ${modelURI}`);
        const providers = this.getProviders(model, modelURI);
        switch (providers.length) {
            case 0:
                return () => Promise.resolve(Diagnostic.ok());
            case 1:
                return providers[0].validate.bind(providers[0]);
            default:
                return multiValidator(providers);
        }
    }

    /**
     * Validate a `model`.
     *
     * @param model the model to validate
     * @param modelURI its resource URI
     * @returns the validation result
     */
    async validate(model: ModelServerObjectV2, modelURI: URI): Promise<Diagnostic> {
        const validator = this.getValidator(model, modelURI);
        return validator(model, modelURI);
    }
}

function createModelTypeFilter(filter?: string | RegExp): (model: ModelServerObjectV2) => boolean {
    if (!filter) return () => true;
    if (typeof filter === 'string') return model => model.$type === filter;
    return model => filter.test(model.$type);
}

function createModelURIFilter(filter?: string | RegExp): (modelURI: string) => boolean {
    if (!filter) return () => true;
    if (typeof filter === 'string') return modelURI => modelURI.includes(filter);
    return modelURI => filter.test(modelURI);
}

function multiValidator(providers: ValidationProvider[]): Validator {
    return async (model: ModelServerObjectV2, modelURI: URI) => {
        const diagnostics = await Promise.all(providers.map(v => v.validate(model, modelURI)));
        return summarize(model, modelURI, diagnostics);
    };
}

function summarize(model: ModelServerObjectV2, modelURI: URI, diagnostics: Diagnostic[]): Diagnostic {
    const result = Diagnostic.merge(...diagnostics);
    if (result.severity > OK) {
        result.message = `Diagnosis of ${modelURI.toString()}`;
        result.id = '/';
    }
    return result;
}
