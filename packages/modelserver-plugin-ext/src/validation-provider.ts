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

import { Diagnostic, ModelServerObjectV2 } from '@eclipse-emfcloud/modelserver-client';
import * as URI from 'urijs';

import { MaybePromise } from './util';
/**
 * Protocol for a provider of custom validation rules that may be registered by a _Model Server_ plug-in.
 */
export interface ValidationProvider {
    /**
     * Query whether the provider can and is interested in validating the given `model`.
     * Only a provider registered against pattern(s) matching the model URI and/or model type
     * will be consulted as a first-level filter.
     *
     * @param model the model to be validated
     * @param modelURI the URI of the model resource
     * @returns whether the provider can and will validate the given `model`
     */
    canValidate(model: ModelServerObjectV2, modelURI: URI): boolean;

    /**
     * Validate the given `model`.
     *
     * @param model the model to be validated
     * @param modelURI the URI of the model resource
     * @returns the result of validation of the `model`
     */
    validate(model: ModelServerObjectV2, modelURI: URI): MaybePromise<Diagnostic>;
}
