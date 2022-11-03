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
import { Diagnostic, encode, ModelServerObjectV2 } from '@eclipse-emfcloud/modelserver-client';
import { Logger } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, named, postConstruct } from 'inversify';
import * as URI from 'urijs';

import { InternalModelServerClientApi } from '../client/model-server-client';
import { validateModelURI } from '../client/uri-utils';
import { JSONSocket } from '../client/web-socket-utils';
import { ValidationProviderRegistry } from '../validation-provider-registry';
import { SubscriptionManager } from './subscription-manager';

/**
 * Custom routing of requests on the `/api/v2/validation` endpoint.
 * The primary such customization is an intercept of the `GET` request for validation
 * to delegate the implementation of custom validation providers.
 */
@injectable()
export class ValidationManager {
    @inject(Logger)
    @named(ValidationManager.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(ValidationProviderRegistry)
    protected readonly validationProviderRegistry: ValidationProviderRegistry;

    @inject(SubscriptionManager)
    protected readonly subscriptionManager: SubscriptionManager;

    @postConstruct()
    initialize(): void {
        this.subscriptionManager.addSubscribedListener((client, params) => {
            if (params.livevalidation) {
                this.initializeLiveValidation(client, validateModelURI(params.modeluri));
            }
        });
    }

    async validate(modelURI: URI): Promise<Diagnostic> {
        let model: ModelServerObjectV2;
        try {
            model = await this.modelServerClient.get(modelURI.toString()).then(asModelServerObject);
            if (!model) {
                throw new Error(`Could not retrieve model '${modelURI}' to validate.`);
            }
        } catch (error) {
            this.logger.error(`Failed to retrieve model '${modelURI}' to validate: ${error}`);
            throw error;
        }

        this.logger.debug(`Performing core validation of ${modelURI}`);
        const defaultDiagnostic = await this.modelServerClient.validate(modelURI.toString());

        this.logger.debug(`Performing custom validation of ${modelURI}`);
        const providedDiagnostic = await this.validationProviderRegistry.validate(model, modelURI);

        const result = Diagnostic.merge(defaultDiagnostic, providedDiagnostic);
        return result;
    }

    /**
     * Perform live validation of a model. The result is not a validation result but
     * success (or not) of the validation operation, itself.
     *
     * @param modelURI the model URI to validate
     * @returns whether validation was successfully performed and broadcast (not whether it found no problems)
     */
    async performLiveValidation(modelURI: URI): Promise<boolean> {
        // Short-circuit if there are no live validation subscribers
        if (!this.subscriptionManager.hasValidationSubscribers(modelURI)) {
            this.logger.debug(`No subscribers to live validation for ${modelURI}.`);
            return true;
        }

        this.logger.debug(`Performing live validation of ${modelURI}.`);
        return this.validate(modelURI)
            .then(results => this.subscriptionManager.broadcastValidation(modelURI, results))
            .catch(reason => {
                this.logger.error('Live validation failed.', reason);
                return false;
            });
    }

    protected async initializeLiveValidation(client: JSONSocket, modelURI: URI): Promise<unknown> {
        return this.validate(modelURI)
            .then(diagnostics => this.subscriptionManager.sendValidation(client, diagnostics))
            .catch(error => this.logger.error(`Failed to initialize live validation in subscription to ${modelURI}: ${error}`));
    }
}

/**
 * Ensure that an object parsed from incoming JSON is a {@link ModelServerObject}.
 *
 * @param object some object reconstituted from JSON
 * @returns the `object` as a {@link ModelServerObject}
 */
function asModelServerObject(object: any): ModelServerObjectV2 | undefined {
    const result = encode('json-v2')(object);
    if (ModelServerObjectV2.is(result)) {
        return result;
    }

    return undefined;
}
