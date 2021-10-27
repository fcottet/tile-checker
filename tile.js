$(document).ready(function(){
    min = function(a,b) {
        if (a>b) return b;
        return a;
    }

    max = function(a,b) {
        if (a>b) return a;
        return b;
    }

    var Tile = L.Rectangle.extend({
        options: {
            tile_id: 0
        },

        initialize: function (latlngs, options) {
            L.Rectangle.prototype.initialize.call(this, latlngs, options);
            this.selected = false;
            this.highlighted = false;
            this.iserror = false
        },
        update: function() {
            let opacity = 0;
            let fill_color = this.options.color;
            if (this.iserror) {
                opacity = 0.7;
                fill_color = "orange";
            }
            if (this.selected) opacity += 0.2;
            if (this.highlighted) opacity += 0.1;
            this.setStyle({fillOpacity:opacity, fillColor:fill_color});
        },

        error: function(level) {
            this.iserror = level;
            this.update();
        },
        highlight: function(level) {
            this.highlighted = level;
            this.update();
        },
        select: function(level) {
            this.selected = level;
            this.update();
        },

    });

    tile = function (id, options) {
        return new Tile(id, options);
    };


    var mymap = L.map('mapid', {zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel:100, wheelDebounceTime:20});
    var routePolyline = false;
    var actualTrace = false;

    var tilesLayerGroup = L.layerGroup().addTo(mymap);

    function TileFromCoord(lat, lon) {
        let n = Math.pow(2,14);
        let x = Math.floor(n * (lon + 180 ) / 360);
        let lat_r = lat*Math.PI/180;
        let y = Math.floor(n * ( 1 - ( Math.log( Math.tan(lat_r) + 1/Math.cos(lat_r) ) / Math.PI ) ) / 2);
        return [x, y];
    }

    function TileIdFromLatLng(latlon) {
        let ll = TileFromCoord(latlon.lat, latlon.lng)
        return ll[0] + "_" + ll[1]
    }

    function LatLngFromTile(x, y) {
        let n = Math.pow(2,14);
        let lat = Math.atan( Math.sinh( Math.PI * (1 - 2*y / n ) ) ) * 180.0 / Math.PI;
        let lon = x / n * 360.0 - 180.0;
        return L.latLng(lat, lon);
    }

    function boundsFromTile(x, y) {
        return L.latLngBounds(LatLngFromTile(x, y), LatLngFromTile(x+1, y+1));
    }

    function boundsFromTileId(tileId) {
        let part = tileId.split('_')
        let x = parseInt(part[0])
        let y = parseInt(part[1])
        return boundsFromTile(x, y)
    }

    var displayed_tiles = new Map();
    var selected_tiles = []
    var visited_tiles = []
    var routes_visited_tiles = []
    var error_tiles = []


    function updateMapTiles(e) {
        if (mymap.getZoom()<10) {
            // Remove tiles
            displayed_tiles.clear();
            tilesLayerGroup.clearLayers();
        } else {
            // display tiles
            let bounds = mymap.getBounds();
            let t1 = TileFromCoord(bounds.getNorth(), bounds.getWest())
            let t2 = TileFromCoord(bounds.getSouth(), bounds.getEast())
            for (let x=min(t1[0], t2[0]); x<max(t1[0], t2[0])+1; x++) {
                for (let y=min(t1[1], t2[1]); y<max(t1[1], t2[1])+1; y++) {
                    let tile_id = x + "_" + y
                    if (!displayed_tiles.has(tile_id)) {
                        let color = 'blue';
                        let weight = 0.1;
                        let opacity = 0;
                        if (!visited_tiles.includes(tile_id)) {
                            color = 'red';
                            weight = 1.0;
                        }
                        if (routes_visited_tiles.includes(tile_id)) {
                            opacity = 0.3;
                        }
                        let tile_rect = tile(boundsFromTile(x, y), {color: color, fillColor: color, fillOpacity:opacity, weight:weight, tile_id:tile_id}).addTo(tilesLayerGroup);
                        displayed_tiles.set(tile_id, tile_rect);
                        if (selected_tiles.includes(tile_id)) {
                            tile_rect.select(1)
                        }
                        if (error_tiles.includes(tile_id)) {
                            tile_rect.error(1)
                        }
                    } else {
                        let tile = displayed_tiles.get(tile_id)
                        if (selected_tiles.includes(tile_id)) {
                            tile.select(1);
                        } else {
                            tile.select(0);
                        }
                    }
                }
            }
        }
    }
    mymap.setView(JSON.parse(localStorage.getItem("map_center")) || [48.85, 2.35],
                    JSON.parse(localStorage.getItem("map_zoom")) || 10);
    mymap.on("moveend", function() {
        localStorage.setItem("map_zoom", JSON.stringify(mymap.getZoom()))
        localStorage.setItem("map_center", JSON.stringify(mymap.getCenter()))
        updateMapTiles();
    });
    mymap.on("load", updateMapTiles);

    mymap.on("click", function(e) {
        if (!$('#alert-split').hasClass("d-none")) return;
        if (selectLoc!=false) return;
        if (mymap.getZoom()>=10) {
            let tile_id = TileIdFromLatLng(e.latlng)
            let tile = displayed_tiles.get(tile_id)
            if (selected_tiles.includes(tile_id)) {
                selected_tiles.splice(selected_tiles.indexOf(tile_id), 1);
                tile.select(0);
            } else {
                selected_tiles.push(tile_id);
                tile.select(1);
            }
            localStorage.setItem("selected_tiles", JSON.stringify(selected_tiles));

            request_route();
        }
    });

    function latlonToStr(ll) {
        return ll.lat + ","+ ll.lng;
    }
    function latlonToQuery(ll) {
        return  [ll.lat, ll.lng];
    }

    var routeId="";
    var timeoutID=false;
    var active_timeout = 0;
    var route_rq_id = 0;
    var sessionId = false;
    var state = false;

    function setMessageAlert(level) {
        $("#progress-message").removeClass(function(index, className){
            return (className.match(/(^|\s)alert-\S+/g)||[]).join('')
        }).addClass('alert-'+level);
    }

    function route_status(timeout_id) {
        if (timeout_id != active_timeout) return;
        $.getJSON({
            url: 'route_status',
            data: { 'sessionId': sessionId, 'findRouteId' : routeId },
            success: function ( data ) {
                if (data['status']=="OK") {
                    state = data['state']
                    $("#message").text($.i18n("message-state-"+data['state']));
                    if ('route' in data) {
                        routeId = data['findRouteId']
                        if (!routePolyline) {
                            routePolyline = L.polyline(data.route, {color: '#FF0000', opacity:0.8}).addTo(mymap);
                        } else {
                            routePolyline.setLatLngs(data.route).bringToFront();
                        }
                        $("#length").text(parseFloat(data['length']).toFixed(2)+" km");
                    }
                    if (data['state']!='complete') {
                        timeoutID = window.setTimeout(route_status, 1000, ++active_timeout);
                    } else {
                        setMessageAlert('success');
                        $("#spinner-searching").hide();
                        $("#button-download-route").show();
                        timeoutID = false;
                        actualTrace =  {distance: data.length, route: data.route, polyline: routePolyline};
                        $('button#addTrace').prop("disabled", false);
                    }
                } else {
                    $("#message").text($.i18n("message-state-fail")+":"+$.i18n("msg-error_"+data['error_code']));
                    setMessageAlert('danger');
                    $("#length").text("");
                    error_tiles = data.error_args;
                    for (let i=0; i<error_tiles.length; i++) {
                        let tile = displayed_tiles.get(error_tiles[i])
                        tile.error(1);
                    }
                    $("#spinner-searching").hide();
                    timeoutID = false;
                }

            }
        });
    };

    { // CONFIG-STORAGE
        $('select.config-storage').each(function(){
            let id = this.id;
            let storage = localStorage.getItem(id)
            if (storage) {
                let val = $(this).find('option[data-value="'+storage+'"]').val();
                $(this).val(val);
            }

            $(this).on('change', function(e) {
                e.preventDefault();
                $(this).data('value', $(this).find(':selected').data('value'));
                localStorage.setItem(this.id, $(this).find(':selected').data('value'));
            });
        });

        $('input[type="text"].config-storage,input[type="number"].config-storage').each(function(){
            let id = this.id;
            $(this).val(localStorage.getItem(id) || "");

            $(this).on('change', function(e) {
                e.preventDefault();
                localStorage.setItem(this.id, $(this).val());
            });
        });

        $('input[type="checkbox"].config-storage').each(function(){
            let id = this.id;
            $(this).prop('checked', (localStorage.getItem(id) || "true") == "true");

            $(this).on('change', function(e) {
                e.preventDefault();
                localStorage.setItem(this.id, this.checked);
            });
        });

        $('.request-route').on("change", function() {
            request_route();
        });
    } // CONFIG-STORAGE

    
    

    mymap.on("click", function (e) {
        if (selectLoc==false) return;
        if (selectLoc=="waypoint") {
            add_waypoint(e.latlng);
        } else {
            add_marker(selectLoc, e.latlng);
            update_circle();
            localStorage.setItem(selectLoc, e.latlng.lat+","+e.latlng.lng);
        }
        selectLoc = false;
        request_route();
    });


    { // local Storage recovery
        function load_marker(name) {
            let lcs = localStorage.getItem(name)
            if (lcs) {
                add_marker(name, lcs.split(','));
            }
        }
        load_marker("start");
        load_marker("end");
        update_circle();

        try {
            selected_tiles = JSON.parse(localStorage.getItem("selected_tiles")) || []
        } catch(e) {
            if (typeof localStorage.getItem("selected_tiles")=='string') {
                selected_tiles = localStorage.getItem("selected_tiles").split(",");
            } // COMPATIBILITY
        }

        updateMapTiles();
    }
});