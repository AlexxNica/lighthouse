/**
 * @license
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Tests whether the page is using passive event listeners.
 */

'use strict';

const Gatherer = require('../gatherer');

class EventListeners extends Gatherer {

  listenForScriptParsedEvents() {
    return this.driver.sendCommand('Debugger.enable').then(_ => {
      this.driver.on('Debugger.scriptParsed', script => {
        this._parsedScripts.set(script.scriptId, script);
      });
    });
  }

  unlistenForScriptParsedEvents() {
    this.driver.off('Debugger.scriptParsed', this.listenForScriptParsedEvents);
    return this.driver.sendCommand('Debugger.disable');
  }

  /**
   * @param {number|string} nodeIdOrObject The node id of the element or the
   *     string of and object ('document', 'window').
   * @return {!Promise<!Array.<EventListener>>}
   * @private
   */
  _listEventListeners(nodeIdOrObject) {
    let promise;

    if (typeof nodeIdOrObject === 'string') {
      promise = this.driver.sendCommand('Runtime.evaluate', {
        expression: nodeIdOrObject,
        objectGroup: 'event-listeners-gatherer' // populates event handler info.
      });
    } else {
      promise = this.driver.sendCommand('DOM.resolveNode', {
        nodeId: nodeIdOrObject,
        objectGroup: 'event-listeners-gatherer' // populates event handler info.
      });
    }

    return promise.then(result => {
      const obj = result.object || result.result;
      return this.driver.sendCommand('DOMDebugger.getEventListeners', {
        objectId: obj.objectId
      }).then(results => {
        return {listeners: results.listeners, tagName: obj.description};
      });
    });
  }

  /**
   * Collects the event listeners attached to an object and formats the results.
   * listenForScriptParsedEvents should be called before this method to ensure
   * the page's parsed scripts are collected at page load.
   * @param {string} nodeId The node to look for attached event listeners.
   * @return {!Promise<!Array.<Object>>} List of event listeners attached to
   *     the node.
   */
  getEventListeners(nodeId) {
    const matchedListeners = [];

    return this._listEventListeners(nodeId).then(results => {
      results.listeners.forEach(listener => {
        // Slim down the list of parsed scripts to match the found event
        // listeners that have the same script id.
        const script = this._parsedScripts.get(listener.scriptId);
        if (script) {
          // Combine the EventListener object and the result of the
          // Debugger.scriptParsed event so we get .url and other
          // needed properties.
          const combo = Object.assign(listener, script);
          combo.objectName = results.tagName;

          // Note: line/col numbers are zero-index. Add one to each so we have
          // actual file line/col numbers.
          combo.line = combo.lineNumber + 1;
          combo.col = combo.columnNumber + 1;

          matchedListeners.push(combo);
        }
      });

      return matchedListeners;
    });
  }

  /**
   * Aggregates the event listeners used on each element into a single list.
   * @param {Array.<Element>} nodes List of elements to fetch event listeners for.
   * @return {!Promise<!Array.<Object>>} Resolves to a list of all the event
   *     listeners found across the elements.
   */
  collectListeners(nodes) {
    return nodes.reduce((chain, node) => {
      return chain.then(prevArr => {
        // Call getEventListeners once for each node in the list.
        return this.getEventListeners(node.element ? node.element.nodeId : node)
            .then(result => prevArr.concat(result));
      });
    }, Promise.resolve([]));
  }

  beforePass(options) {
    this.driver = options.driver;
    this._parsedScripts = new Map();
    return this.listenForScriptParsedEvents();
  }

  afterPass(options) {
    return this.unlistenForScriptParsedEvents()
        .then(_ => options.driver.querySelectorAll('body, body /deep/ *')) // drill into shadow trees
        .then(nodes => {
          nodes.push('document', 'window');
          return this.collectListeners(nodes);
        })
        .then(listeners => {
          this.artifact = listeners;
        }).catch(_ => {
          this.artifact = {
            rawValue: -1,
            debugString: 'Unable to collect passive events listener usage.'
          };
        });
  }
}

module.exports = EventListeners;
