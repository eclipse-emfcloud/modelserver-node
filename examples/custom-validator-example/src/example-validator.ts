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

import { Diagnostic, ModelServerObjectV2, WARNING } from '@eclipse-emfcloud/modelserver-client';
import {
    Logger,
    MaybePromise,
    ModelServerClientApi,
    ModelServerPlugin,
    ModelServerPluginContext,
    ValidationProvider
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, named } from 'inversify';

/**
 * A simple example of a plug-in that provides custom validation.
 */
@injectable()
export class ExampleCustomValidationPlugin implements ModelServerPlugin {
    @inject(Logger)
    @named(ExampleCustomValidationPlugin.name)
    protected readonly logger: Logger;

    @inject(ModelServerClientApi)
    protected modelServerClient: ModelServerClientApi;

    initialize(context: ModelServerPluginContext): MaybePromise<boolean> {
        context.registerValidationProvider(new CoffeeMachineValidator(this.modelServerClient, this.logger), {
            modelType: /coffeemodel#\/\/Machine$/
        });
        this.logger.info('Registered example Coffee Machine validation provider.');
        return true;
    }
}

/**
 * A simple example of a custom validation provider that randomly returns a warning on validation of a coffee machine.
 */
class CoffeeMachineValidator implements ValidationProvider {
    constructor(protected readonly modelServerClient: ModelServerClientApi, protected readonly logger: Logger) {}

    canValidate(model: ModelServerObjectV2, modelURI: string): boolean {
        return true; // Nothing further to check than the pattern supplied at registration
    }

    validate(model: ModelServerObjectV2, modelURI: string): Diagnostic {
        const probabilityTest = Math.random();
        if (probabilityTest < 0.5) {
            return Diagnostic.ok();
        }

        return {
            severity: WARNING,
            source: '@eclipse-emfcloud/coffee-custom-validators-example',
            code: 1,
            message: 'This is a randomly occurring example diagnostic.',
            data: [probabilityTest],
            children: [],
            id: ''
        };
    }
}
