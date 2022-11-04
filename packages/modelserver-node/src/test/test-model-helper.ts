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
import { ModelServerObjectV2 } from '@eclipse-emfcloud/modelserver-client';

export interface CoffeeMachine extends ModelServerObjectV2 {
    name?: string;
}

export namespace CoffeeMachine {
    export const TYPE = 'http://www.eclipsesource.com/modelserver/example/coffeemodel#//Machine';
}

export function isCoffeeMachine(obj: unknown): obj is CoffeeMachine {
    return ModelServerObjectV2.is(obj) && obj.$type === CoffeeMachine.TYPE;
}
