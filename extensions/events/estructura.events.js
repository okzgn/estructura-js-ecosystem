(function(global, factory){
	'use strict';
	if(typeof exports === 'object' && typeof module !== 'undefined'){
		module.exports = factory();
	}
	else if(typeof define === 'function' && define.amd){
		define(factory);
	}
	else {
		global._events = factory();
	}
}(this, function(){
	'use strict';

    var
    array_check_str = '[object Array]',
    get_primitive_type_fn = Object.prototype.toString,
    verify_own_property_fn = Object.prototype.hasOwnProperty,
    verify_weakmap = typeof WeakMap === 'function';

    function _is_object(object){
        return object && typeof object === 'object';
    }

    function _is_function(fn){
        return typeof fn === 'function';
    }

    function _is_undefined(data){
        return typeof data === 'undefined';
    }

    function _is_array(object){
        return get_primitive_type_fn.call(object) === array_check_str;
    }

	function simple_object_copy(destination_object, source_object){
		for(var field in source_object){
			if(!verify_own_property_fn.call(source_object, field)){ continue; }
			destination_object[field] = source_object[field];
		}
        return destination_object;
	}

    var
    _events = _e.instance('events'),
    _events_on = true,
    _events_library = verify_weakmap ? new WeakMap() : {},
    _events_last_id = 0;

    _events.pause = function(){ _events_on = false; };
    _events.resume = function(){ _events_on = true; };

    _events.subtype('browser-dom');

    _events.subtype({
        Object: function(input){
            return _is_function(input.addEventListener) && _is_function(input.removeEventListener) ? 'EventTarget' : false;
        }
    });

    _events.fn({
        EventTarget: {
            on: _iteration_wrapper(_on),
            off: _iteration_wrapper(_off)
        }
    });

    _events.fn({
        Window: { load: _custom_iteration_wrapper('Window', 'load') },
        Document: { ready: _custom_iteration_wrapper('Document', 'DOMContentLoaded') }
    });

    function _custom_iteration_wrapper(event_from, events){
        return function(arg){
            return _iterate_elements(_on, event_from, [arg[0]], [events].concat(Array.prototype.slice.call(arguments, 1)));
        }
    }

    function _iteration_wrapper(iteration_fn){
        return function(arg) {
            var types = _events.type(arg[0]), event_from = 'EventTarget';

            if(types['Node']){ event_from = 'Node'; }
            else if(types['Nodes']){ event_from = 'Nodes'; }
            else if(types['Document']){ event_from = 'Document'; }
            else if(types['Window']){ event_from = 'Window'; }

            return _iterate_elements(iteration_fn, event_from, (event_from === 'Nodes' ? arg[0] : [arg[0]]), Array.prototype.slice.call(arguments, 1));
        }
    }

    function _iterate_elements(iteration_fn, event_from, elements, args){
        var iterator = 0;
        var events_list = [];
        var have_event_names = args[0] && typeof args[0] === 'string';
        if(have_event_names){
            args[0] = args[0].replace(/^[\s\,]+|[\s\.\,]+$/g, '');
            if(args[0].length < 2){ return; }

            events_list = args[0].split(/[\,\s]+/);

            for(iterator = 0; iterator < events_list.length; iterator++){
                events_list[iterator] = events_list[iterator].replace(/^\.+/g, '.').replace(/\.+$/g, '').split(/\.+/);
                
                events_list[iterator] = {
                    name: events_list[iterator][0] ? events_list[iterator][0].replace(/^on/i, '').toLowerCase() : '',
                    id: events_list[iterator][1] ? events_list[iterator].slice(1).join('.') : ''
                }

                if(events_list[iterator].name === 'domcontentloaded'){
                    events_list[iterator].name = 'DOMContentLoaded';
                }
            }
        }

        args = [have_event_names, event_from].concat(args);

        for(var element = 0; element < elements.length; element++){
            iterator = 0;
            do {
                if(have_event_names){ args[2] = events_list[iterator++]; }
                iteration_fn.apply(elements[element], args);
            }
            while(iterator < events_list.length);
        }
        return this;
    }

    function _return_event_library(event_from, reference, mode){
        if(!verify_weakmap){
            try {
                if(!mode && isNaN(reference._e_events_id)){
                    reference._e_events_id = String(_events_last_id++);
                    _events_library[reference._e_events_id] = {};
                }

                return _events_library[reference._e_events_id];
            }
            catch(e){
                throw new Error('Can\'t set events to this ' + event_from + ': ' + e.message);
            }
        }

        if(!mode && !_events_library.has(reference)){
            _events_library.set(reference, {});
        }

        return _events_library.get(reference);
    }

    function _on(call_mode, event_from, event, fn, data){
        if(!_is_function(fn)){
            return _on_event.call(this, call_mode, event_from, event, {}, (!_is_object(fn) ? {} : fn));
        }

        if(!call_mode || !event.name){ return; }

        data = (!_is_object(data) ? {} : data);

        var _event_library = _return_event_library(event_from, this);
        if(!_event_library){ return; }

        if(!_is_object(_event_library[event.name])){
            _event_library[event.name] = {};
        }

        event.mode = _event_mode(data);

        if(!_is_function(_event_library[event.name][event.mode])){
            _event_library[event.name][event.mode] = function(event_data){
                return _on_event.call(this, call_mode, event_from, { name: event.name, mode: event.mode, id: '' }, event_data, simple_object_copy({}, data));
            };

            this.addEventListener(event.name, _event_library[event.name][event.mode], data);
        }

        if(!_is_object(_event_library[event.name][event.mode][event.id]) || _is_undefined(_event_library[event.name][event.mode][event.id].length)){
           _event_library[event.name][event.mode][event.id] = [];
        }

        if(data.overwrite === true){ _event_library[event.name][event.mode][event.id] = [fn]; }
        else { _event_library[event.name][event.mode][event.id].push(fn); }
    }

    function _event_mode(object){
        return ((object.once ? '_once' : '') + (object.capture ? '_capture' : '') + (object.passive ? '_passive' : '') + (object.signal ? '_signal' : '')) || 'default';
    }

    function _on_event(call_mode, event_from, event, event_data, data){
        if(!_events_on || !_return_event_library(event_from, this, true)){ return; }

        event = !_is_object(event) ? {} : event;

        if(!call_mode){
            data = event;
            event = {};
        }
        else {
            _change_mode(event, data);
        }

        var have_errors = [];
        _event_libraries_iteration.call(this, event_from, event, function(event_id_library, id){
            if(event_id_library[id].paused && !data.resume){ return; }

            if(data.resume){
                delete event_id_library[id].paused;
                if(!data.execute){ return; }
            }

            var current_fns = event_id_library[id];
            for(var fn = 0; fn < current_fns.length; fn++){
                try {
                    if(!_is_function(current_fns[fn])){ throw new Error('Not a function, internal unexpected change.'); }
                    current_fns[fn].call(this, event_data);
                }
                catch(e) {
                    have_errors.push('Error from: ' + event_from + ': ' + id + ': ' + fn + ': ' + e.message);
                }
            }

            if(data.once === true){
                _off.call(this, true, event_from, { name: event.name, mode: event.mode, id: id }, data);
            }
        });

        if(have_errors.length){
            throw new Error(have_errors.join("\n"));
        }
    }

    function _change_mode(event, data){
        var has_explicit_data = !!data;
        if(has_explicit_data){
            var have_mode = false;

            if(typeof data !== 'string'){
                for(var key in data){
                    if(!verify_own_property_fn.call(data, key) || key === 'pause' || key === 'resume' || key === 'overwrite'){
                        continue;
                    }
                    have_mode = true;
                    break;
                }
            }

            if(have_mode){
                event.mode = _event_mode(data);
            }
        }
    }

    function _off(call_mode, event_from, event, data){
        if(!_events_on || !_return_event_library(event_from, this, true)){ return; }

        if(!call_mode){
            data = event;
            event = {};
        }
        else {
            _change_mode(event, data);
        }

        data = (!_is_object(data) ? {} : data);

        _event_libraries_iteration.call(this, event_from, event,
            function(event_id_library, id){
                if(data.pause){
                    event_id_library[id].paused = true;
                    return;
                }
                delete event_id_library[id];
            },

            function(event_mode_library, mode){

            },

            function(event_name_library, name){
                if(data.pause){ return; }

                var has_modes_left = false;

                for(var mode in event_name_library[name]){
                    var wrapper_fn = event_name_library[name][mode];
                    var has_ids_left = false;
                    
                    for(var key in wrapper_fn){
                        if(verify_own_property_fn.call(wrapper_fn, key) && _is_array(wrapper_fn[key]) && wrapper_fn[key].length > 0){
                            has_ids_left = true;
                            break;
                        }
                    }

                    if(!has_ids_left){
                        this.removeEventListener(name, wrapper_fn, mode.indexOf('_capture') !== -1);
                        delete event_name_library[name][mode];
                    }
                    else {
                        has_modes_left = true;
                    }
                }

                if(!has_modes_left){
                    delete event_name_library[name];
                }
            }
        );
    }

    function _event_libraries_iteration(event_from, event, event_id_fn, event_mode_fn, event_name_fn){
        var _event_library = _return_event_library(event_from, this, true);
        for(var registered_event_name in _event_library){
            if(!verify_own_property_fn.call(_event_library, registered_event_name) || (event.name && event.name !== registered_event_name)){ continue; }

            for(var registered_event_mode in _event_library[registered_event_name]){
                if(!verify_own_property_fn.call(_event_library[registered_event_name], registered_event_mode) || (event.mode && event.mode !== registered_event_mode)){ continue; }

                for(var registered_event_id in _event_library[registered_event_name][registered_event_mode]){
                    if(!verify_own_property_fn.call(_event_library[registered_event_name][registered_event_mode], registered_event_id) || (event.id && event.id !== registered_event_id)){ continue; }

                    event_id_fn.call(this, _event_library[registered_event_name][registered_event_mode], registered_event_id);
                }

                if(event_mode_fn){ event_mode_fn.call(this, _event_library[registered_event_name], registered_event_mode); }
            }

            if(event_name_fn){ event_name_fn.call(this, _event_library, registered_event_name); }
        }
    }

    return _events;
}));
