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

import { Operation } from 'fast-json-patch';

import { Transaction } from './executor';
import { MaybePromise } from './util';

/**
 * Protocol for a provider of "triggers" that may be registered by a _Model Server_ plug-in.
 * A trigger is invoked to inspect the changes that were performed by an edit and provides
 * side-effects to follow up those changes with further changes required to maintain
 * model consistency/completeness/correctness.
 *
 * Triggers operate recursively: the edits applied by triggers themselves trigger invocation
 * of trigger-providers to compute further side-effects. For this reason it is crucial that
 * trigger providers check their initial conditions and not respond to triggering patches
 * when the model is already in the state that the trigger provider would ensure.
 */
export interface TriggerProvider {
    /**
     * Query whether the provider offers any follow-up changes for the given `patch`.
     * If the provider returns `true` then it _may_ provide follow-up edits.
     * Otherwise, it will not be invoked to provide anything.
     *
     * @param modelURI the URI of the model for which the `patch` describes changes
     * @param patch a JSON Patch describing model changes performed by a triggering edit
     * @returns whether the provider has any edits to add to the given `patch`
     */
    canTrigger(modelURI: string, patch: Operation[]): boolean;

    /**
     * Obtain follow-up edits triggered by the given `patch`. These may either be
     * a self-describing patch or a transaction call-back that will perform an ad hoc
     * sequence of edits.
     *
     * @param modelURI the URI of the model for which the `patch` describes changes
     * @param modelDelta a JSON Patch describing the model changes for which to obtain triggered edits
     * @returns either a patch describing further changes to the model
     *     or a transaction that should be run in the context of a transactional
     *     compound command {@link Executor}
     */
    getTriggers(modelURI: string, modelDelta: Operation[]): MaybePromise<Operation[] | Transaction>;
}
