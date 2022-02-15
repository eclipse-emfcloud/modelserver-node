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

import { ModelServerClientApi, ModelServerPluginContext } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { ContainerModule } from 'inversify';

import { InternalModelServerClient, InternalModelServerClientApi } from './client/model-server-client';
import { CommandProviderRegistry } from './command-provider-registry';
import { BasicModelServerPluginContext, InternalModelServerPluginContext } from './plugin-context';
import { ModelServer } from './server';
import { SubscriptionManager } from './services/subscription-manager';
import { ValidationManager } from './services/validation-manager';
import { ValidationProviderRegistry } from './validation-provider-registry';

export default new ContainerModule(bind => {
    bind(ModelServerClientApi).toService(InternalModelServerClientApi);
    bind(InternalModelServerClientApi).to(InternalModelServerClient).inSingletonScope();

    bind(CommandProviderRegistry).toSelf().inSingletonScope();
    bind(ValidationProviderRegistry).toSelf().inSingletonScope();

    bind(SubscriptionManager).toSelf().inSingletonScope();
    bind(ValidationManager).toSelf().inSingletonScope();

    bind(BasicModelServerPluginContext).toSelf().inSingletonScope();
    bind(ModelServerPluginContext).toService(InternalModelServerPluginContext);
    bind(InternalModelServerPluginContext).to(BasicModelServerPluginContext);

    bind(ModelServer).toSelf().inSingletonScope();
});
