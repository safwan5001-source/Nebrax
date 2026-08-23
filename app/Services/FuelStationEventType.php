<?php

namespace App\Services;

/**
 * مفردات الحدث المعيارية المستقرة بين المحولات ونواة المحطات.
 *
 * وجود النوع لا يعني أن aggregate المنتج موجود أو أن الحدث يولّد أثراً الآن؛
 * كل منتج/مستهلك فعلي يُقدّم في دورته المعتمدة فقط.
 */
enum FuelStationEventType: string
{
    case STATION_CREATED = 'station.created';
    case STATION_CONFIGURATION_CHANGED = 'station.configuration.changed';
    case ATG_READING_RECORDED = 'atg.reading.recorded';
    case TANK_ALARM_RAISED = 'tank.alarm.raised';
    case TANK_ALARM_CLEARED = 'tank.alarm.cleared';
    case FORECOURT_TRANSACTION_RECORDED = 'forecourt.transaction.recorded';
    case PUMP_STATUS_CHANGED = 'pump.status.changed';
    case NOZZLE_METER_RECORDED = 'nozzle.meter.recorded';
    case SHIFT_OPENED = 'shift.opened';
    case SHIFT_CLOSED = 'shift.closed';
    case SHIFT_APPROVED = 'shift.approved';
    case FUEL_DELIVERY_RECEIVED = 'fuel.delivery.received';
    case FUEL_INVENTORY_RECONCILED = 'fuel.inventory.reconciled';
    case VEHICLE_IDENTIFIED = 'vehicle.identified';
    case FUEL_AUTHORIZATION_APPROVED = 'fuel.authorization.approved';
    case FUEL_AUTHORIZATION_DENIED = 'fuel.authorization.denied';
    case DEVICE_HEALTH_CHANGED = 'device.health.changed';
    case DEVICE_CONNECTION_CHANGED = 'device.connection.changed';
}
