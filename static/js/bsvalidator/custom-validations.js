// Dongyt Form
$(document).ready(function () {
    $('#dongytForm').bootstrapValidator({
        message: '有非法值存在',
        feedbackIcons: {
            valid: 'fa fa-check',
            invalid: 'fa fa-times',
            validating: 'fa fa-refresh'
        },
        fields: {
            course_name: {
                validators: {
                    notEmpty: {
                        message: '球场名称不能为空'
                    }
                }
            },
            hole_count: {
                validators: {
                    notEmpty: {
                        message: '球洞数不能为空'
                    },
                    lessThan: {
                        value: 50,
                        inclusive: true,
                        message: '球洞不超过50个'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: true,
                        message: '球洞数要大于或等于0'
                    }
                }
            },
            area_name: {
                validators: {
                    notEmpty: {
                        message: '区域名称不能为空'
                    }
                }
            },
            turf_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            moisture: {
                validators: {
                    notEmpty: {
                        message: '调整%不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: true,
                        message: '调整%要大于或等于0'
                    }
                }
            },
            shape_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            nozzle_model_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            radius: {
                validators: {
                    notEmpty: {
                        message: '喷洒半径不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '喷洒半径要大于0'
                    }
                }
            },
            nozzle_model_flow: {
                validators: {
                    notEmpty: {
                        message: '流量不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '流量要大于0'
                    }
                }
            },
            controlbox_model_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            max_point_count: {
                validators: {
                    notEmpty: {
                        message: '最大站点数不能为空'
                    },
                    lessThan: {
                        value: 100,
                        inclusive: true,
                        message: '最大站点不超过100个'
                    },
                    greaterThan: {
                        value: 1,
                        inclusive: true,
                        message: '最大站点数要大于0'
                    }
                }
            },
            controlbox_no: {
                validators: {
                    notEmpty: {
                        message: '设备编号不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '设备编号要大于0的整数'
                    }
                }
            },
            controlbox_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            nozzle_count: {
                validators: {
                    notEmpty: {
                        message: '最大站点数不能为空'
                    },
                    lessThan: {
                        value: 100,
                        inclusive: true,
                        message: '能支持的最大站点不超过100个'
                    },
                    greaterThan: {
                        value: 1,
                        inclusive: true,
                        message: '能支持的最大站点数要大于0'
                    }
                }
            },
            lon: {
                validators: {
                    notEmpty: {
                        message: '经度不能为空'
                    },
                    lessThan: {
                        value: 180,
                        inclusive: true,
                        message: '经度必须小于180°'
                    },
                    greaterThan: {
                        value: -180,
                        inclusive: true,
                        message: '经度必须大于-180°'
                    }
                }
            },
            lat: {
                validators: {
                    notEmpty: {
                        message: '纬度不能为空'
                    },
                    lessThan: {
                        value: 90,
                        inclusive: true,
                        message: '纬度必须小于90°'
                    },
                    greaterThan: {
                        value: -90,
                        inclusive: true,
                        message: '纬度必须大于-90°'
                    }
                }
            },
            nozzle_no: {
                validators: {
                    notEmpty: {
                        message: '洒水站编号不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '洒水站编号要大于0的整数'
                    }
                }
            },
            nozzle_name: {
                validators: {
                    notEmpty: {
                        message: '名称不能为空'
                    }
                }
            },
            hole: {
                validators: {
                    notEmpty: {
                        message: '球洞不能为空'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: true,
                        message: '球洞要大于或等于0的整数'
                    }
                }
            },
            angle: {
                validators: {
                    lessThan: {
                        value: 360,
                        inclusive: true,
                        message: '夹角要小于或等于360°的整数'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '夹角要大于0°的整数'
                    }
                }
            },
            shot_count: {
                validators: {
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '喷头数量要大于0的整数'
                    }
                }
            },
            waterfall_rate: {
                validators: {
                    greaterThan: {
                        value: 0,
                        inclusive: false,
                        message: '降水率要大于0'
                    }
                }
            },
            hour: {
                validators: {
                    greaterThan: {
                        value: 0,
                        inclusive: true,
                        message: '小时要大于或等于0'
                    }
                }
            },
            minute: {
                validators: {
                    lessThan: {
                        value: 59,
                        inclusive: true,
                        message: '分钟不超过59'
                    },
                    greaterThan: {
                        value: 0,
                        inclusive: true,
                        message: '分钟要大于或等于0'
                    }
                }
            }
        }
    });
});

// Default Form
$(document).ready(function () {
    $('#defaultForm').bootstrapValidator({
        message: 'This value is not valid',
        feedbackIcons: {
            valid: 'fa fa-check',
            invalid: 'fa fa-times',
            validating: 'fa fa-refresh'
        },
        fields: {
            username: {
                message: 'The username is not valid',
                validators: {
                    notEmpty: {
                        message: 'The username is required and can\'t be empty'
                    },
                    stringLength: {
                        min: 6,
                        max: 30,
                        message: 'The username must be more than 6 and less than 30 characters long'
                    },
                    regexp: {
                        regexp: /^[a-zA-Z0-9_\.]+$/,
                        message: 'The username can only consist of alphabetical, number, dot and underscore'
                    }
                }
            },
            country: {
                validators: {
                    notEmpty: {
                        message: 'The country is required and can\'t be empty'
                    }
                }
            },
            acceptTerms: {
                validators: {
                    notEmpty: {
                        message: 'You have to accept the terms and policies'
                    }
                }
            },
            email: {
                validators: {
                    notEmpty: {
                        message: 'The email address is required and can\'t be empty'
                    },
                    emailAddress: {
                        message: 'The input is not a valid email address'
                    }
                }
            },
            website: {
                validators: {
                    uri: {
                        message: 'The input is not a valid URL'
                    }
                }
            },
            phoneNumberUS: {
                validators: {
                    phone: {
                        message: 'The input is not a valid US phone number'
                    }
                }
            },
            phoneNumberUK: {
                validators: {
                    phone: {
                        message: 'The input is not a valid UK phone number',
                        country: 'GB'
                    }
                }
            },
            color: {
                validators: {
                    hexColor: {
                        message: 'The input is not a valid hex color'
                    }
                }
            },
            zipCode: {
                validators: {
                    zipCode: {
                        country: 'US',
                        message: 'The input is not a valid US zip code'
                    }
                }
            },
            password: {
                validators: {
                    notEmpty: {
                        message: 'The password is required and can\'t be empty'
                    },
                    identical: {
                        field: 'confirmPassword',
                        essage: 'The password and its confirm are not the same'
                    }
                }
            },
            confirmPassword: {
                validators: {
                    notEmpty: {
                        message: 'The confirm password is required and can\'t be empty'
                    },
                    identical: {
                        field: 'password',
                        message: 'The password and its confirm are not the same'
                    }
                }
            },
            ages: {
                validators: {
                    lessThan: {
                        value: 100,
                        inclusive: true,
                        message: 'The ages has to be less than 100'
                    },
                    greaterThan: {
                        value: 10,
                        inclusive: false,
                        message: 'The ages has to be greater than or equals to 10'
                    }
                }
            }
        }
    });
});

// Credit Card
$(document).ready(function () {
    $('#paymentForm').bootstrapValidator({
        feedbackIcons: {
            valid: 'fa fa-check',
            invalid: 'fa fa-times',
            validating: 'fa fa-refresh'
        },
        fields: {
            cardHolder: {
                selector: '#cardHolder',
                validators: {
                    notEmpty: {
                        message: 'The card holder is required'
                    },
                    stringCase: {
                        message: 'The card holder must contain upper case characters only',
                        case: 'upper'
                    }
                }
            },
            ccNumber: {
                selector: '#ccNumber',
                validators: {
                    notEmpty: {
                        message: 'The credit card number is required'
                    },
                    creditCard: {
                        message: 'The credit card number is not valid'
                    }
                }
            },
            expMonth: {
                selector: '[data-stripe="exp-month"]',
                validators: {
                    notEmpty: {
                        message: 'The expiration month is required'
                    },
                    digits: {
                        message: 'The expiration month can contain digits only'
                    },
                    callback: {
                        message: 'Expired',
                        callback: function (value, validator) {
                            value = parseInt(value, 10);
                            var year = validator.getFieldElements('expYear').val(),
                                currentMonth = new Date().getMonth() + 1,
                                currentYear = new Date().getFullYear();
                            if (value < 0 || value > 12) {
                                return false;
                            }
                            if (year == '') {
                                return true;
                            }
                            year = parseInt(year, 10);
                            if (year > currentYear || (year == currentYear && value > currentMonth)) {
                                validator.updateStatus('expYear', 'VALID');
                                return true;
                            } else {
                                return false;
                            }
                        }
                    }
                }
            },
            expYear: {
                selector: '[data-stripe="exp-year"]',
                validators: {
                    notEmpty: {
                        message: 'The expiration year is required'
                    },
                    digits: {
                        message: 'The expiration year can contain digits only'
                    },
                    callback: {
                        message: 'Expired',
                        callback: function (value, validator) {
                            value = parseInt(value, 10);
                            var month = validator.getFieldElements('expMonth').val(),
                                currentMonth = new Date().getMonth() + 1,
                                currentYear = new Date().getFullYear();
                            if (value < currentYear || value > currentYear + 10) {
                                return false;
                            }
                            if (month == '') {
                                return false;
                            }
                            month = parseInt(month, 10);
                            if (value > currentYear || (value == currentYear && month > currentMonth)) {
                                validator.updateStatus('expMonth', 'VALID');
                                return true;
                            } else {
                                return false;
                            }
                        }
                    }
                }
            },
            cvvNumber: {
                selector: '.cvvNumber',
                validators: {
                    notEmpty: {
                        message: 'The CVV number is required'
                    },
                    cvv: {
                        message: 'The value is not a valid CVV',
                        creditCardField: 'ccNumber'
                    }
                }
            }
        }
    });
});

$(document).ready(function () {
    $('#movieForm').bootstrapValidator({
        feedbackIcons: {
            valid: 'fa fa-check',
            invalid: 'fa fa-times',
            validating: 'fa fa-reload'
        },
        fields: {
            title: {
                group: '.col-md-8',
                validators: {
                    notEmpty: {
                        message: 'The title is required'
                    },
                    stringLength: {
                        max: 200,
                        message: 'The title must be less than 200 characters long'
                    }
                }
            },
            genre: {
                group: '.col-md-4',
                validators: {
                    notEmpty: {
                        message: 'The genre is required'
                    }
                }
            },
            director: {
                group: '.col-md-4',
                validators: {
                    notEmpty: {
                        message: 'The director name is required'
                    },
                    stringLength: {
                        max: 80,
                        message: 'The director name must be less than 80 characters long'
                    }
                }
            },
            writer: {
                group: '.col-md-4',
                validators: {
                    notEmpty: {
                        message: 'The writer name is required'
                    },
                    stringLength: {
                        max: 80,
                        message: 'The writer name must be less than 80 characters long'
                    }
                }
            },
            producer: {
                group: '.col-md-4',
                validators: {
                    notEmpty: {
                        message: 'The producer name is required'
                    },
                    stringLength: {
                        max: 80,
                        message: 'The producer name must be less than 80 characters long'
                    }
                }
            },
            website: {
                group: '.col-md-6',
                validators: {
                    notEmpty: {
                        message: 'The website address is required'
                    },
                    uri: {
                        message: 'The website address is not valid'
                    }
                }
            },
            trailer: {
                group: '.col-md-6',
                validators: {
                    notEmpty: {
                        message: 'The trailer link is required'
                    },
                    uri: {
                        message: 'The trailer link is not valid'
                    }
                }
            },
            review: {
                // The group will be set as default (.form-group)
                validators: {
                    stringLength: {
                        max: 500,
                        message: 'The review must be less than 500 characters long'
                    }
                }
            },
            rating: {
                // The group will be set as default (.form-group)
                validators: {
                    notEmpty: {
                        message: 'The rating is required'
                    }
                }
            }
        }
    });
});