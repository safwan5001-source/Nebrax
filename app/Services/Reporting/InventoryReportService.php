<?php

namespace App\Services\Reporting;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Support\ProductWarehouseBalanceQuery;
use App\Support\ReportBranchScope;
use App\Support\ReportWarehouseScope;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use RuntimeException;
