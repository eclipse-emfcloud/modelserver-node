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

import { ContainerModule } from 'inversify';

import { ModelsRoutes } from './models';
import { RouteProvider } from './routes';
import { SubscriptionRoutes } from './subscription';
import { UndoRedoRoutes } from './undo-redo';
import { ValidationRoutes } from './validation';

export default new ContainerModule(bind => {
    bind(RouteProvider).to(ModelsRoutes);
    bind(RouteProvider).to(ValidationRoutes);
    bind(RouteProvider).to(UndoRedoRoutes);
    bind(RouteProvider).to(SubscriptionRoutes);
});
