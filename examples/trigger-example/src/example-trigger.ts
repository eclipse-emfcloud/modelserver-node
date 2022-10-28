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

import { AnyObject, ModelServerObjectV2, Operations, replace } from '@eclipse-emfcloud/modelserver-client';
import {
    Logger,
    MaybePromise,
    ModelServerClientApi,
    ModelServerPlugin,
    ModelServerPluginContext,
    TriggerProvider
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { AddOperation, Operation, ReplaceOperation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';

/**
 * A simple example of a plug-in that provides triggers for automatic update of model objects.
 */
@injectable()
export class ExampleTriggerPlugin implements ModelServerPlugin {
    @inject(Logger)
    @named(ExampleTriggerPlugin.name)
    protected readonly logger: Logger;

    @inject(ModelServerClientApi)
    protected modelServerClient: ModelServerClientApi;

    initialize(context: ModelServerPluginContext): MaybePromise<boolean> {
        context.registerTriggerProvider(new IncrementDurationTriggerProvider(this.modelServerClient, this.logger));
        this.logger.info('Registered example round durations trigger provider.');
        return true;
    }
}

/**
 * A simple example of a trigger provider that ensures the `duration` of a `Task` is always a multiple of ten.
 */
class IncrementDurationTriggerProvider implements TriggerProvider {
    constructor(protected readonly modelServerClient: ModelServerClientApi, protected readonly logger: Logger) {}

    canTrigger(modelURI: URI, patch: Operation[]): boolean {
        return patch.some(isDurationChange);
    }

    async getTriggers(modelURI: URI, modelDelta: Operation[]): Promise<Operation[]> {
        // In this case, because the trigger updates the same properties previously modified,
        // we have all the information we need in the `modelDelta`. But in the general case,
        // a trigger provider will need to find other related objects in the model and generate
        // new changes from those, so that's how we do it here
        const model = await this.modelServerClient.get(modelURI.toString());
        const result: Operation[] = [];

        // Take only the last change to any given duration in case of multiple (such as
        // may happen with the example custom `increment-duration` command)
        uniqueLastBy(modelDelta.filter(isDurationChange), op => op.path).forEach(op => {
            const element = findObject(model, op.path);
            // Don't update if already a multiple of ten
            if (element && op.value % 10 !== 0) {
                this.logger.debug('Rounding up duration %d of object at %s', op.value, op.path);
                result.push(replace(modelURI.toString(), element, 'duration', roundUp(op.value, 10)));
            }
        });

        return result;
    }
}

/** Type guard for an `Operation` that is a change in a task duration. */
function isDurationChange(op: Operation): op is AddOperation<number> | ReplaceOperation<number> {
    return (Operations.isAdd(op, 'number') || Operations.isReplace(op, 'number')) && op.path.endsWith('/duration');
}

function uniqueLastBy<T, K>(items: T[], keyFunc: (item: T) => K): T[] {
    const result = new Map<K, T>();

    items.forEach(item => result.set(keyFunc(item), item));

    return Array.from(result.values());
}

function roundUp(n: number, nearest: number): number {
    return Math.ceil(n / nearest) * nearest;
}

function findObject(root: AnyObject, path: string): ModelServerObjectV2 | undefined {
    const steps = path.split('/').filter(item => item.length > 0);

    // The whole path includes the terminal property. We want the object owning that property,
    // which is the path up to but not including that last segment
    return findObjectRecursive(root, steps.slice(0, -1));
}

function findObjectRecursive(root: AnyObject | AnyObject[], steps: string[]): ModelServerObjectV2 | undefined {
    if (steps.length === 0) {
        return ModelServerObjectV2.is(root) ? root : undefined;
    }

    if (Array.isArray(root)) {
        // We're indexing into an array property
        const index = Number.parseInt(steps[0], 10);
        const next = root[index];
        if (AnyObject.is(next)) {
            return findObjectRecursive(next, steps.slice(1));
        }
    } else if (AnyObject.is(root) && steps[0] in root) {
        const next = root[steps[0]];
        if (AnyObject.is(next) || isArrayOfAnyObject(next)) {
            return findObjectRecursive(next, steps.slice(1));
        }
    }

    return undefined;
}

function isArrayOfAnyObject(object: unknown): object is AnyObject[] {
    return Array.isArray(object) && (object.length === 0 || AnyObject.is(object[0]));
}
