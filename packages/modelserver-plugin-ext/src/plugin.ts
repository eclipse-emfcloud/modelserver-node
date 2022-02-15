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

import { CommandProvider } from './command-provider';
import { MaybePromise } from './util';
import { ValidationProvider } from './validation-provider';

/**
 * Plug-in service registration token that provides for unregistering the service when it is no longer needed/viable.
 */
export interface Registration<K, T> {
    /** The key under which the service was registered. */
    key: K;
    /** The service that was registered. */
    service: T;
    /** Unregister the service. */
    unregister(): void;
}

export const ModelServerPluginContext = Symbol('ModelServerPluginContext');

/**
 * A protocol for call-backs that plug-ins may use to register provided services and obtain
 * information about the _Model Server_ environment in which they are running.
 */
export interface ModelServerPluginContext {
    /**
     * Register a provider of a custom command type.
     *
     * @param commandType the command type supported by the provider
     * @param provider the provider of the command
     */
    registerCommandProvider(commandType: string, provider: CommandProvider): Registration<string, CommandProvider>;

    /**
     * Register a provider of custom model validation rules.
     * If no `options` are specified, then the provider will be invoked for validation of all models.
     *
     * @param provider the validation provider
     * @param options registration options, primarily for filtering
     */
    registerValidationProvider(
        provider: ValidationProvider,
        options?: ValidationProviderRegistrationOptions
    ): Registration<string, ValidationProvider>;
}

export const ModelServerPlugin = Symbol('ModelServerPlugin');

/**
 * A plug-in that extends the _Model Server_ with custom business logic.
 */
export interface ModelServerPlugin {
    /**
     * Optional call-back for a plug-in to initialize itself in the given server `context`.
     *
     * @param context the context in which the _Model Server Plug-in_ is run
     * @returns whether initialization succeeded. A plug-in must return `false` or a rejected promise
     *     if it did not initialize and should not participate in the server
     */
    initialize?(context: ModelServerPluginContext): MaybePromise<boolean>;
}

/**
 * Options for registration of a validation provider.
 */
export interface ValidationProviderRegistrationOptions {
    /** A pattern to match model URIs for which the provider will be invoked. */
    modelURI?: string | RegExp;
    /** A pattern to match the `$type` of `ModelServerObject` for which the provider will be invoked. */
    modelType?: string | RegExp;
}
