_e.subtype({
    String: {
        Print: function(a){
            return a === 'print';
        }
    }
});

_e.fn({
    Print: {
        String: function(print, string){
            console.info(string);
        }
    }
})

_e('print', 'Estructura, JavaScript Framework.');