(function(global, factory){
	'use strict';
	if(typeof exports === 'object' && typeof module !== 'undefined'){
		module.exports = factory();
	}
	else if(typeof define === 'function' && define.amd){
		define(factory);
	}
	else {
		global._reactive = factory();
	}
}(this, function(){
    'use strict';

    var
    boolean_attrs = { disabled: true, checked: true, readonly: true, required: true, selected: true },
    private_fns = { on: true, off: true, stop: true, event: true },
    re_vars = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

    function _error(message){
        var e = new Error(message);
        e.name = '';
        throw e;
    }

    var _reactive = _e.instance('reactive');
    _reactive.subtype('browser-dom');

    _reactive.fn(function(_reactive_node, _reactive_config){
        var _reactive_node_type = _reactive.type(_reactive_node);
        if(!_reactive_node_type['Node']){
            _error('"' + _reactive_node_type.join(', ') + '" not a Node.');
        }

        function _extract_variable_fn(callback){
            return function(text, last_position){
                var end = last_position || 0;
                while(true){
                    var prefix = text.indexOf(re_prefix, end);
                    if(prefix === -1){ return; }

                    var postfix = text.indexOf(re_postfix, prefix + re_prefix.length);
                    if(postfix === -1){ return; }

                    var name = text.slice(prefix + re_prefix.length, postfix).trim();
                    var is_var = re_vars.test(name);

                    postfix = postfix + re_postfix.length;
                    
                    if(callback){
                        try { name = callback(name, { expr: !is_var, start: prefix, end: postfix }); }
                        catch(e){ _error('Variables processor error: ' + e.message); }
                    }

                    if(name){
                        return {
                            variable: name,
                            start: prefix,
                            end: postfix,
                            expr: !is_var
                        };
                    }

                    end = postfix;
                }
            }
        }

        var
        re_prefix = '{{',
        re_postfix = '}}',
        extract_variables_fn = _extract_variable_fn(),
        extract_variables_processor = null;

        if(_reactive_config){
            if(typeof _reactive_config !== 'object'){
                _error('Reactive config. must be an object.');
            }

            if(_reactive_config.variables_prefix && typeof _reactive_config.variables_prefix === 'string'){
                re_prefix = _reactive_config.variables_prefix;
            }

            if(_reactive_config.variables_postfix && typeof _reactive_config.variables_postfix === 'string'){
                re_postfix = _reactive_config.variables_postfix;
            }

            if(_reactive_config.variables_preprocessor && typeof _reactive_config.variables_preprocessor === 'function'){
                extract_variables_fn = _extract_variable_fn(_reactive_config.variables_preprocessor);
            }

            if(_reactive_config.variables_processor && typeof _reactive_config.variables_processor === 'function'){
                extract_variables_processor = _reactive_config.variables_processor;
            }
        }

        if(_reactive_node.nodeType === 9){
            _reactive_node = _reactive_node.documentElement;
        }

        var
        _reactive_exposed_object = Object.create(null),
        _reactive_render_element;

        var
        render_pending_updates = new Map(),
        render_is_flush_scheduled = false,
        events = {
            createdVariable: false,
            deletedVariable: false,
            beforeMutateVariable: false,
            afterMutateVariable: false,
            reactiveOn: false,
            reactiveOff: false,
            reactiveStop: false,
        };

        _reactive_exposed_object.on = _reactive_state_on;
        _reactive_exposed_object.stop = _reactive_state_stop;
        _reactive_exposed_object.off = _reactive_state_off;
        _reactive_exposed_object.event = function(eventName, fn){
            if(!eventName || typeof eventName !== 'string' || typeof events[eventName] === 'undefined'){
                _error('Unrecognized event: ' + eventName);
            }

            if(typeof fn !== 'function'){
                _error('Cannot use with event: ' + String(fn));
            }

            events[eventName] = function(){
                try { fn.apply(null, arguments); }
                catch(e){ _error(eventName + ' event error: ' + e.message); }
            }
        }

        var _reactive_exposed_state = new Proxy(_reactive_exposed_object, {
            set: function(target, property, value){
                if(typeof property !== 'string'){
                  _error('Cannot use symbol as property name: ' + property);
                }

                if(private_fns[property]){
                    _error('Cannot use private method name: ' + property);
                }

                if(target[property] !== value){
                    target[property] = value;
                    var element = _reactive_render_element || render_pending_updates.get(property);
  
                    render_pending_updates.set(property, element);
                    if(!render_is_flush_scheduled){
                        render_is_flush_scheduled = true;
                        Promise.resolve().then(_render_flush_updates);
                    }
                }
                return true;
            }
        });

        function _render_flush_updates(){
            var pending_updates = new Map(render_pending_updates).entries();
            render_pending_updates.clear();
            render_is_flush_scheduled = false;
            for(var variable of pending_updates){ _reactive_state_render_variable(variable[0], variable[1]); }
        }

        var
        variables,
        variables_nodes,
        attribute_registry,
        expr_registry,
        reactive_templates,
        ignored_mutations;

        function _reactive_registries(){
            variables = new Map();
            variables_nodes = new WeakMap();
            attribute_registry = new WeakMap();
            expr_registry = new Map();
            reactive_templates = new WeakMap();
            ignored_mutations = new WeakMap();
        }

        _reactive_registries();

        var _node_types = {
            'add': {
                '3': function(node){
                    var parsed = _parse_template(node.textContent);
                    if(!parsed){ return; }

                    var template = parsed.template;
                    var extracted = parsed.variables;

                    var parent = node.parentNode;
                    if(parent && parent.nodeName === 'TEXTAREA'){
                        if(extracted.length > 1){
                            _error('Only "' + extracted[0] + '" will be available.');
                        }

                        var registry = attribute_registry.get(parent) || {};
                        
                        if(registry['value'] && registry['value'] !== node){
                            var boundVars = variables_nodes.get(registry['value']);
                            var firstVar = boundVars && boundVars[0] ? boundVars[0] : extracted[0];
                            _error('Only "' + firstVar + '" will be available.');
                        }

                        registry['value'] = node;
                        attribute_registry.set(parent, registry);
                    }

                    if(!reactive_templates.has(node)){
                        reactive_templates.set(node, template);
                    }

                    for(var i = 0; i < extracted.length; i++){
                        _add_variable(node, extracted[i]);
                    }
                },

                '2': function(node){
                    if(typeof node.value !== 'string' || node.value.indexOf(re_prefix) === -1){
                        return;
                    }

                    var parsed = _parse_template(node.value);
                    if(!parsed){ return; }

                    var template = parsed.template;
                    var extracted = parsed.variables;

                    if((node.name === 'value' || node.name === 'checked') && extracted.length > 1){
                        _error('Only "' + extracted[0] + '" will be available.');
                    }

                    if(!reactive_templates.has(node)){
                        reactive_templates.set(node, template);
                    }

                    for(var i = 0; i < extracted.length; i++){
                        _add_variable(node, extracted[i], node.name);
                    }

                    var owner = node.ownerElement;
                    if(owner){
                        var registry = attribute_registry.get(owner) || {};
                        registry[node.name] = node;
                        attribute_registry.set(owner, registry);
                    }
                },

                '1': function(node){
                    if(node !== _reactive_node && node.outerHTML && node.outerHTML.indexOf(re_prefix) === -1){
                        return;
                    }

                    if(node.hasAttributes()){ 
                        var i = 0, attrs = node.attributes;
                        while(i < attrs.length){
                            if(typeof attrs[i].value === 'string'){
                                _node_types.add['2'](attrs[i]);
                            }
                            i++;
                        }
                    }

                    _mutations_iterator('add', node.childNodes);
                }
            },
            'del': {
                '3': function(node){
                    _delete_variable(node);
                },

                '2': function(node){
                    if(node.ownerElement){
                        _delete_attr_variable(node.ownerElement, node.nodeName);
                    }
                    else {
                        _delete_variable(node);
                    }
                },

                '1': function(node){
                    var walker = document.createTreeWalker(
                        node,
                        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );

                    var currentNode = walker.currentNode;
                    while(currentNode){
                        if(currentNode.nodeType === 3){
                            if(variables_nodes.has(currentNode)){
                                _delete_variable(currentNode);
                            }
                        }
                        else if(currentNode.nodeType === 1){
                            if(currentNode.hasAttributes()){
                                var attrs = currentNode.attributes;
                                for(var i = 0; i < attrs.length; i++){
                                    var attrNode = attrs[i];
                                    if(variables_nodes.has(attrNode)){
                                        _delete_attr_variable(currentNode, attrNode.nodeName);
                                    }
                                }
                            }
                        }
                        currentNode = walker.nextNode();
                    }
                }
            }
        };

        function _parse_template(text){
            var template = _compile_template(text);
            if(template.length <= 1){ return; }

            var extracted = [];
            for(var i = 1; i < template.length; i += 2){
                var variable = template[i];
                if(extracted.indexOf(variable) === -1){
                    extracted.push(variable);
                }
            }

            return {
                template: template,
                variables: extracted
            };
        }

        function _compile_template(text){
            var segments = [];
            var last_position = 0;
            var result;

            while((result = extract_variables_fn(text, last_position)) !== undefined){
                var varName = result.expr ? ('_e_' + result.start + '_' + result.end) : result.variable;
                if(result.expr && !expr_registry.has(varName)){
                    expr_registry.set(varName, result.variable);
                }
                segments.push(text.slice(last_position, result.start));
                segments.push(varName);
                last_position = result.end;
            }

            segments.push(text.slice(last_position));
            return segments;
        }

        function _execute_template(compiled){
            var renderedText = compiled[0];
            for(var i = 1; i < compiled.length; i += 2){
                var val = _reactive_exposed_state[compiled[i]];
                renderedText += (val !== undefined ? val : '') + compiled[i + 1];
            }
            return renderedText;
        }

        function _ignore_mutation(target, type, attrName){
            var record = ignored_mutations.get(target);
            if(!record){
                record = { characterData: 0, attributes: new Set() };
                ignored_mutations.set(target, record);
            }

            if(type === 'characterData'){
                record.characterData++;
            }
            else if(type === 'attributes'){
                record.attributes.add(attrName);
            }
        }

        function _should_delete_ignored(record, target){
            if(record.characterData === 0 && record.attributes.size === 0){
                ignored_mutations.delete(target);
            }
        }

        function _should_ignore_and_consume(mutation){
            var record = ignored_mutations.get(mutation.target);
            if(!record){ return false; }

            if(mutation.type === 'characterData'){
                if(record.characterData > 0){
                    record.characterData--;
                    _should_delete_ignored(record, mutation.target);
                    return true;
                }
            }
            else if(mutation.type === 'attributes'){
                if(record.attributes.has(mutation.attributeName)){
                    record.attributes.delete(mutation.attributeName);
                    _should_delete_ignored(record, mutation.target);
                    return true;
                }
            }
            return false;
        }

        function _delete_variable(node){
            var varsInNode = variables_nodes.get(node);
            if(!varsInNode){ return; }

            if(node.nodeType === 3 && node.parentNode && node.parentNode.nodeName === 'TEXTAREA'){
                var registry = attribute_registry.get(node.parentNode);
                if(registry && registry['value'] === node){
                    delete registry['value'];
                }
            }

            for(var i = 0; i < varsInNode.length; i++){
                var variableName = varsInNode[i];
                var nodesArray = variables.get(variableName);

                if(nodesArray){
                    var newNodesArray = nodesArray.filter(function(item){
                        return item.node !== node && item.node.isConnected;
                    });

                    if(newNodesArray.length === 0){
                        variables.delete(variableName);
                        _reactive_state_on_variable_del(variableName);
                    }
                    else {
                        variables.set(variableName, newNodesArray);
                    }
                }
            }

            variables_nodes.delete(node);
            reactive_templates.delete(node);
        }

        function _delete_attr_variable(element, attrName){
            var registry = attribute_registry.get(element);
            if(registry && registry[attrName]){
                var attrNode = registry[attrName];
                var boundVariables = variables_nodes.get(attrNode);
                
                if(boundVariables){
                    for(var i = 0; i < boundVariables.length; i++){
                        var variableName = boundVariables[i];
                        var nodesArray = variables.get(variableName);
                        
                        if(nodesArray){
                            var newArray = nodesArray.filter(function(item){
                                return item.node !== attrNode;
                            });
                            
                            if(newArray.length === 0){
                                variables.delete(variableName);
                                _reactive_state_on_variable_del(variableName);
                            }
                            else {
                                variables.set(variableName, newArray);
                            }
                        }
                    }
                }
                
                variables_nodes.delete(attrNode);
                reactive_templates.delete(attrNode);
                delete registry[attrName];
            }
        }

        function _add_variable(node, variableName, attrName){
            var is_new_variable = !variables.has(variableName);

            if(is_new_variable){
                variables.set(variableName, [{ node: node, attr: attrName }]);
            }
            else {
                var nodesArray = variables.get(variableName);
                var isDuplicated = false;
                
                for(var i = 0; i < nodesArray.length; i++){
                    if(nodesArray[i].node === node){
                        isDuplicated = true;
                        break;
                    }
                }
                
                if(!isDuplicated){
                    nodesArray.push({ node: node, attr: attrName });
                }
            }

            if(!variables_nodes.has(node)){
                variables_nodes.set(node, []);
            }

            if(variables_nodes.get(node).indexOf(variableName) === -1){
                variables_nodes.get(node).push(variableName);
            }

            if(is_new_variable){
                _reactive_state_on_variable_add(variableName);
            }
        }

        function _mutations_iterator(mode, nodes){
            if(!nodes.length){ return; }
            var j = nodes.length;
            while(j--){
                var node_type = nodes[j].nodeType + '';
                if(_node_types[mode][node_type]){
                    _node_types[mode][node_type](nodes[j]);
                }
            }
        }

        var _dom_reactive = new MutationObserver(function(list, observer){
            var l = 0;
            while(l < list.length){
                var mutation = list[l];

                if(_should_ignore_and_consume(mutation)){
                    l++;
                    continue;
                }

                if(mutation.type === 'childList'){
                    _mutations_iterator('add', mutation.addedNodes);
                    _mutations_iterator('del', mutation.removedNodes);
                }
                else {
                    var node_type = mutation.target.nodeType + '';
                    switch(mutation.type){
                        case 'attributes':
                            var element = mutation.target;
                            var attrName = mutation.attributeName;
                            
                            var attrNode = element.attributes.getNamedItem(attrName);
                            
                            _delete_attr_variable(element, attrName);
                            if(attrNode){
                                _node_types.add['2'](attrNode);
                            }
                        break;
                        case 'characterData':
                            _node_types.del[node_type](mutation.target);
                            _node_types.add[node_type](mutation.target);
                        break;
                    }
                }
                l++;
            }
        });

        function _reactive_state_on(){
            if(_reactive_node.nodeType === 1 || _reactive_node.nodeType === 3){
                _node_types.add[_reactive_node.nodeType](_reactive_node);
            }

            for(var variableName of variables.keys()){
                _reactive_state_render_variable(variableName);
            }
            
            _reactive_state_start();

            if(typeof events.reactiveOn === 'function'){
                events.reactiveOn();
            }
        }

        function _reactive_state_start(){
            _reactive_node.addEventListener('input', _reactive_state_input_handler);
            _reactive_node.addEventListener('change', _reactive_state_input_handler);

            _dom_reactive.observe(_reactive_node, {
                attributes: true,
                attributeOldValue: true,
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        function _reactive_state_stop(){
            _reactive_node.removeEventListener('input', _reactive_state_input_handler);
            _reactive_node.removeEventListener('change', _reactive_state_input_handler);
            
            _dom_reactive.disconnect();

            render_pending_updates.clear();
            render_is_flush_scheduled = false;

            if(typeof events.reactiveStop === 'function'){
                events.reactiveStop();
            }
        }

        function _reactive_state_off(){
            _reactive_state_stop();

            if(typeof events.reactiveOff === 'function'){
                events.reactiveOff();
            }

            _reactive_registries();
        }

        function _reactive_state_input_handler(event){
            if(!event || !event.target){ return; }
            var element = event.target;
            
            var isCheckboxOrRadio = element.type === 'checkbox' || element.type === 'radio';
            var bindingKey = isCheckboxOrRadio ? 'checked' : 'value';

            var registry = attribute_registry.get(element);
            if(!registry || !registry[bindingKey]){ return; }
            
            var attrNode = registry[bindingKey];
            var boundVariables = variables_nodes.get(attrNode);
            
            if(boundVariables && boundVariables.length > 0){
                var variableName = boundVariables[0];
                var newValue = isCheckboxOrRadio ? element.checked : element.value;

                if(_reactive_exposed_state[variableName] !== newValue){
                    _reactive_render_element = element;
                    _reactive_exposed_state[variableName] = newValue;
                    _reactive_render_element = null;
                }
            }
        }

        function _reactive_state_render_variable(variableName, excludeElement){
            var boundNodes = variables.get(variableName);
            if(!boundNodes){ return; }

            try {
                for(var i = 0; i < boundNodes.length; i++){
                    var item = boundNodes[i];
                    var node = item.node;

                    if(node.nodeType === 2 && node.ownerElement && !node.ownerElement.isConnected){
                        _delete_attr_variable(node.ownerElement, node.nodeName);
                        continue;
                    }
                    else if(node.nodeType === 3 && !node.isConnected){
                        _delete_variable(node);
                        continue;
                    }

                    var associatedElement = node.nodeType === 2 ? node.ownerElement : node.parentNode;
                    if(associatedElement && associatedElement === excludeElement){
                        continue;
                    }

                    var template = reactive_templates.get(node);
                    if(!template){ continue; }

                    if(node.nodeType === 2 && boolean_attrs[node.name]){
                        var stateValue = _reactive_exposed_state[variableName];
                        var owner = node.ownerElement;
                        if(owner){
                            var newValue;

                            if(!stateValue || stateValue === 'false' || stateValue === false){
                                newValue = false;

                                if(typeof events.beforeMutateVariable === 'function' && owner.isConnected){
                                    events.beforeMutateVariable(variableName, newValue, owner, node, node.name);
                                }

                                _ignore_mutation(owner, 'attributes', node.name);

                                owner.removeAttribute(node.name);
                                owner[node.name] = newValue;

                                if(typeof events.afterMutateVariable === 'function' && owner.isConnected){
                                    events.afterMutateVariable(variableName, newValue, owner, node, node.name);
                                }
                            }
                            else {
                                newValue = true;

                                if(typeof events.beforeMutateVariable === 'function' && owner.isConnected){
                                    events.beforeMutateVariable(variableName, newValue, owner, node, node.name);
                                }

                                _ignore_mutation(owner, 'attributes', node.name);

                                owner.setAttribute(node.name, '');
                                owner[node.name] = newValue;

                                if(typeof events.afterMutateVariable === 'function' && owner.isConnected){
                                    events.afterMutateVariable(variableName, newValue, owner, node, node.name);
                                }
                            }
                        }
                        continue;
                    }

                    var renderedText = _execute_template(template);
                    var owner = node.ownerElement;
                    var name;

                    if(node.nodeType === 3){
                        name = 'textContent';

                        if(typeof events.beforeMutateVariable === 'function' && node.isConnected){
                            events.beforeMutateVariable(variableName, renderedText, node.parentNode, node, name);
                        }

                        _ignore_mutation(node, 'characterData');

                        node.textContent = renderedText;

                        if(typeof events.afterMutateVariable === 'function' && node.isConnected){
                            events.afterMutateVariable(variableName, renderedText, node.parentNode, node, name);
                        }
                    }
                    else if(node.nodeType === 2){
                        name = node.name;

                        if(typeof events.beforeMutateVariable === 'function' && owner.isConnected){
                            events.beforeMutateVariable(variableName, renderedText, owner, node, name);
                        }

                        if(owner){
                            _ignore_mutation(owner, 'attributes', node.name);
                        }

                        node.value = renderedText;
                        if(node.name === 'value' && owner){
                            owner.value = renderedText;
                        }

                        if(typeof events.afterMutateVariable === 'function' && owner.isConnected){
                            events.afterMutateVariable(variableName, renderedText, owner, node, name);
                        }
                    }
                }
            }
            catch(e){
                _error('Variable render error: ' + e.message);
            }
        }

        function _reactive_state_on_variable_add(variableName){
            if(!(variableName in _reactive_exposed_object)){
                if(typeof extract_variables_processor === 'function' && expr_registry.has(variableName)){
                    _reactive_exposed_object[variableName] = extract_variables_processor(variableName, expr_registry.get(variableName), _reactive_exposed_object);
                }
                else {
                    _reactive_exposed_object[variableName] = '';
                }

                if(typeof events.createdVariable === 'function'){
                    events.createdVariable(variableName);
                }
            }
        }

        function _reactive_state_on_variable_del(variableName){
            if(variableName in _reactive_exposed_object){
                if(typeof events.deletedVariable === 'function'){
                    events.deletedVariable(variableName);
                }
            }
        }

        try { _reactive_state_on(); }
        catch(e){ _error('Reactive cannot initialize: ' + e.message); }
        return { state: function(){ return _reactive_exposed_state } };
    });

    return _reactive;
}));