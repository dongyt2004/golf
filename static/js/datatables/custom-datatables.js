// Basic DataTable
$(function () {
    $('#basicExample').DataTable({
        'iDisplayLength': 5
    });
});

// Autofill DataTable
$(function () {
    $('#autoFill').DataTable({
        autoFill: true,
        'iDisplayLength': 5
    });
});

// Fixed Header DataTable
$(function () {
    var table = $('#fixedHeader').DataTable({
        fixedHeader: true,
        'iDisplayLength': 5
    });
});

// Responsive Table
$(function () {
    $('#responsiveTable').DataTable({
        responsive: true,
        'iDisplayLength': 5
    });
});

$(function () {
    $('#scrollTable').DataTable({
        "scrollY": "320px",
        "scrollCollapse": true,
        "paging": false,
        'iDisplayLength': 5,
        "ordering": false,
        "language": {
            "emptyTable": "空表",
            "info": "共_TOTAL_条记录，当前显示记录_START_到_END_",
            "infoEmpty": "无记录",
            "infoFiltered": "（一共_MAX_条记录）",
            "search": "查找：",
            "zeroRecords": "没有满足条件的记录"
        }
    });
});