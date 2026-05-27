'use strict';

var
re_prefix = '{{',
re_postfix = '}}',
variables = new Map(),
variables_nodes = new WeakMap(),
attribute_registry = new WeakMap();

function _input_value_handler(event){
    console.log(this.value);
}

var _node_types = {
    'add': {
        '3': function(node){
            var value, position;
            while(value = _extract_variable(node.textContent, position)){
                _add_variable(node, value.variable);
                position = value.position;
            }
        },
        '2': function(node){
            var value, position;
            var has_variables = false;

            while(value = _extract_variable(node.value, position)){
                _add_variable(node, value.variable, node.name);
                position = value.position;
                has_variables = true;
            }

            if(has_variables){
                var owner = node.ownerElement;
                if(owner){
                    var registry = attribute_registry.get(owner) || {};
                    registry[node.name] = node;
                    attribute_registry.set(owner, registry);

                    if(node.name === 'value'){
                        switch(owner.nodeName){
                            case 'SELECT':
                                owner.removeEventListener('change', _input_value_handler);
                                owner.addEventListener('change', _input_value_handler);
                            break;
                            case 'INPUT':
                            case 'TEXTAREA':
                                owner.removeEventListener('input', _input_value_handler);
                                owner.addEventListener('input', _input_value_handler);
                            break;
                        }
                    }
                }
            }
        },
        '1': function(node){
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
            } else {
                _delete_variable(node);
            }
        },
        '1': function(node){
            if(node.hasAttributes()){
                _mutations_iterator('del', node.attributes);
            }

            if(!node.childNodes.length){ return; }
            _mutations_iterator('del', node.childNodes);
        }
    }
};

function _delete_variable(node) {
    var varsInNode = variables_nodes.get(node);
    if (!varsInNode) return;

    for (var i = 0; i < varsInNode.length; i++) {
        var variableName = varsInNode[i];
        var nodesArray = variables.get(variableName);

        if (nodesArray) {
            var newNodesArray = nodesArray.filter(function(item) {
                return item.node !== node && item.node.isConnected;
            });

            if (newNodesArray.length === 0) {
                variables.delete(variableName);
            } else {
                variables.set(variableName, newNodesArray);
            }
        }
    }

    variables_nodes.delete(node);
}

function _delete_attr_variable(element, attrName) {
    variables.forEach(function(nodesArray, variableName) {
        var newArray = nodesArray.filter(function(item) {
            return !(
                item.node.nodeType === 2 &&
                item.node.ownerElement === element &&
                item.node.nodeName === attrName
            );
        });

        if (newArray.length === 0) {
            variables.delete(variableName);
        } else {
            variables.set(variableName, newArray);
        }
    });

    var registry = attribute_registry.get(element);
    if (registry && registry[attrName]) {
        variables_nodes.delete(registry[attrName]);
        delete registry[attrName];
    }
}

function _add_variable(node, variableName, attrName){
    if (!variables.has(variableName)) {
        variables.set(variableName, [{ node: node, attr: attrName }]);
    } else {
        var nodesArray = variables.get(variableName);
        var isDuplicated = false;
        
        for (var i = 0; i < nodesArray.length; i++) {
            if (nodesArray[i].node === node) {
                isDuplicated = true;
                break;
            }
        }
        
        if (!isDuplicated) {
            nodesArray.push({ node: node, attr: attrName });
        }
    }

    if (!variables_nodes.has(node)) {
        variables_nodes.set(node, []);
    }

    if (variables_nodes.get(node).indexOf(variableName) === -1) {
        variables_nodes.get(node).push(variableName);
    }
}

function _extract_variable(text, last_position){
    ///\{\{(.+?)\}\}/g
    var prefix = text.indexOf(re_prefix, last_position || 0);
    if (prefix === -1) return;

    var postfix = text.indexOf(re_postfix, prefix + re_prefix.length);
    if (postfix === -1) return;

    var name = text.slice(prefix + re_prefix.length, postfix).trim();
    if(!name) return;

    return {
        variable: name,
        position: postfix + re_postfix.length
    };
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

var _dom_observer = new MutationObserver(function(list, observer){
    var l = 0;
    while(l < list.length){
        var mutation = list[l];
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
                    if (attrNode) {
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

function _observer_resume(){
    _dom_observer.observe(document.documentElement,{
        attributes: true,
        attributeOldValue: true,
        childList: true,
        subtree: true,
        characterData: true
    });
}

function _observer_pause(){
    _dom_observer.disconnect();
}

_observer_resume();