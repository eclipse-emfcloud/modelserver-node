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
    ModelServerClientApi,
    ModelServerPluginContext,
    ModelService,
    ModelServiceFactory
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { ContainerModule } from 'inversify';

import { InternalModelServerClient, InternalModelServerClientApi } from './client/model-server-client';
import { CommandProviderRegistry } from './command-provider-registry';
import { BasicModelServerPluginContext, InternalModelServerPluginContext } from './plugin-context';
import { ModelServer } from './server';
import { EditService } from './services/edit-service';
import { DefaultModelService, MODEL_URI } from './services/model-service';
import { SubscriptionManager } from './services/subscription-manager';
import { ValidationManager } from './services/validation-manager';
import { TriggerProviderRegistry } from './trigger-provider-registry';
import { ValidationProviderRegistry } from './validation-provider-registry';

export default new ContainerModule(bind => {
    bind(ModelServerClientApi).toService(InternalModelServerClientApi);
    bind(InternalModelServerClientApi).to(InternalModelServerClient).inSingletonScope();

    bind(CommandProviderRegistry).toSelf().inSingletonScope();
    bind(TriggerProviderRegistry).toSelf().inSingletonScope();
    bind(ValidationProviderRegistry).toSelf().inSingletonScope();

    bind(SubscriptionManager).toSelf().inSingletonScope();
    bind(ValidationManager).toSelf().inSingletonScope();
    bind(EditService).toSelf().inSingletonScope();
    bind(DefaultModelService).toSelf();
    bind(ModelService).toService(DefaultModelService);
    bind(ModelServiceFactory).toFactory(context => (modeluri: string) => {
        const child = context.container.createChild();
        child.bind(MODEL_URI).toConstantValue(modeluri);
        return child.get(ModelService);
    });

    bind(BasicModelServerPluginContext).toSelf().inSingletonScope();
    bind(ModelServerPluginContext).toService(InternalModelServerPluginContext);
    bind(InternalModelServerPluginContext).to(BasicModelServerPluginContext);

    bind(ModelServer).toSelf().inSingletonScope();
});
