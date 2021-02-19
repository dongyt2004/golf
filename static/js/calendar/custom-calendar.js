$(function () {

    $(".event-tag span").click(function () {
        $(".event-tag span").removeClass("selected");
        $(this).addClass("selected");
    });

    $(document).on('click', '.remove-event', function (e) {
        $(this).parent().remove();
    });

    /* initialize the external events */

    $('#external-events .fc-event').each(function () {

        // store data so the calendar knows to render an event upon drop
        $(this).data('eventObject', {
            task_id: $(this).attr("data-task_id"),
            durationEditable: false,
            title: $.trim($(this).text()),
            howLong: parseInt($(this).attr("data-how_long")), // use the element's text as the event title
            className: $(this).attr("data-bg"), // use the element's text as the event title
            stick: true // maintain when user navigates (see docs on the renderEvent method)
        });

        // make the event draggable using jQuery UI
        $(this).draggable({
            zIndex: 999,
            revert: true, // will cause the event to go back to its
            revertDuration: 0 //  original position after the drag
        });

    });

    var prev_start, prev_end;

    /* initialize the calendar */
    $('#calendar').fullCalendar({
        height: window.innerHeight - 250,
        windowResize: function(view) {
            $('#calendar').fullCalendar('option', 'height', window.innerHeight - 250);
        },
        locale: 'zh-cn',
        firstDay: new Date().getDay(),
        titleFormat: '制定一周洒水计划',
        allDaySlot: false,
        slotDuration:'00:15:00',
        nowIndicator : true,
        header: {
            center: 'agendaWeek,agendaDay,prev,next',
            right: ''
        },
        defaultView: 'agendaWeek',
        //Add Events
        events: [],

        editable: true,
        eventLimit: true,
        droppable: true, // this allows things to be dropped onto the calendar
        drop: function (date, allDay) { // this function is called when something is dropped
            // retrieve the dropped element's stored Event Object
            var originalEventObject = $(this).data('eventObject');

            // we need to copy it, so that multiple events don't have a reference to the same object
            var copiedEventObject = $.extend({}, originalEventObject);

            var start = date.local();
            var end = date.clone().add(copiedEventObject.howLong, 's').local();
            var overlayPlans = $('#calendar').fullCalendar('clientEvents', function (plan) {
                return copiedEventObject.task_id === plan.task_id && (start.diff(plan.start, 'second') === 0 || start.isBetween(plan.start, plan.end) || plan.start.isBetween(start, end));
            });
            if (overlayPlans.length > 0) {
                alertify.error("同一任务不能相互覆盖，请重新设置洒水时间");
                return;
            }

            // assign it the date that was reported
            copiedEventObject.id = copiedEventObject.task_id + "-" + date.format("YYYYMMDDHHmmss");
            copiedEventObject.start = start;
            copiedEventObject.end = end;
            // copiedEventObject.allDay = allDay;

            // render the event on the calendar
            // the last `true` argument determines if the event "sticks" (http://arshaw.com/fullcalendar/docs/event_rendering/renderEvent/)
            $('#calendar').fullCalendar('renderEvent', copiedEventObject, true);

            // is the "remove after drop" checkbox checked?
            /*if ($('#drop-remove').is(':checked')) {
                // if so, remove the element from the "Draggable Events" list
                $(this).remove();
            }*/

        },
        eventRender: function (plan, element) {
            element.css('overflow', 'visible');
            element.append('<span onclick=del_plan("' + plan.id + '") class="info-label fa fa-close red-bg" style="cursor: pointer;"></span>');
        },
        eventClick: function(plan) {
            var concurrent_tasks = [];
            var events = $("#calendar").fullCalendar('clientEvents');
            for(var i=0; i < events.length; i++) {
                if (events[i].start - plan.start === 0) {
                    concurrent_tasks.push(events[i].task_id);
                }
            }
            window.open ("/plan_flow.html?start=" + plan.start.valueOf() + "&concurrent_tasks=" + JSON.stringify(concurrent_tasks), "newwindow", "height=600, width=900, toolbar=no, menubar=no, scrollbars=no, resizable=no, location=no, status=no");
            return false;
        },
        eventDragStart : function(event) {
            prev_start = event.start.local();
            prev_end = event.end.local();
        },
        eventDrop : function(event) {
            var me_start = event.start.local();
            var me_end = event.end.local();
            var overlayPlans = $('#calendar').fullCalendar('clientEvents', function (plan) {
                var it_start = plan.start.local();
                var it_end = plan.end.local();
                return event.id !== plan.id && event.task_id === plan.task_id && (me_start.diff(it_start, 'second') === 0 || me_start.isBetween(it_start, it_end) || it_start.isBetween(me_start, me_end));
            });
            if (overlayPlans.length > 0) {
                alertify.error("同一任务不能相互覆盖，请重新设置洒水时间");
                event.start = prev_start;
                event.end = prev_end;
                return;
            }
        }
    });

    /*Add new event*/
    // Form to add new event

    $("#createEvent").on('submit', function (ev) {
        ev.preventDefault();

        var $event = $(this).find('.new-event-form'),
            event_name = $event.val(),
            tagColor = $('.event-tag  span.selected').attr('data-tag');

        if (event_name.length >= 3) {

            var newid = "new" + "" + Math.random().toString(36).substring(7);
            // Create Event Entry
            $("#external-events .checkbox").before('<div id="' + newid + '" class="fc-event ' + tagColor + '" data-bg="' + tagColor + '">' + event_name + '<span class="fa fa-close remove-event"></span></div>');

            var eventObject = {
                title: $.trim($("#" + newid).text()),
                className: $("#" + newid).attr("data-bg"), // use the element's text as the event title
                stick: true
            };

            // store the Event Object in the DOM element so we can get to it later
            $("#" + newid).data('eventObject', eventObject);

            // Reset draggable
            $("#" + newid).draggable({
                revert: true,
                revertDuration: 0,
                zIndex: 999
            });

            // Reset input
            $event.val('').focus();
        } else {
            $event.focus();
        }
    });
});
