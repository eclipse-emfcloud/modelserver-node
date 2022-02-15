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

import { ModelServerPlugin } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { ContainerModule } from 'inversify';

import { ExampleCustomCommandPlugin } from './example-command';

export default new ContainerModule(bind => {
    bind(ModelServerPlugin).to(ExampleCustomCommandPlugin);
});
