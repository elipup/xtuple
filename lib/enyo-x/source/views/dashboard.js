/*jshint bitwise:true, indent:2, curly:true, eqeqeq:true, immed:true,
latedef:true, newcap:true, noarg:true, regexp:true, undef:true,
trailing:true, white:true*/
/*global XT:true, XM:true, XV:true, _:true, window: true, enyo:true, nv:true, d3:true, console:true */

(function () {

  enyo.kind({
    name: "XV.Dashboard",
    published: {
      label: "_dashboard".loc(),
    }
  });

  /**
    Generic implementation of customizable bar chart.
    You can pull in a filtered fetch on the
    backing collection for this chart. Then you can apply another arbitrary filter of your
    choice by means of a picker, and choose a group-by field. The kind will
    display a bar chart given the requirements. The "total" can be a count or
    a sum of a field of your choice. You can click on a bar to see a list of the
    items that comprise it, and drill down into an individual workspace from
    that list.

    Uses nvd3 for SVG rendering.
  */
  enyo.kind(
    /** @lends XV.SelectableChart */{
    name: "XV.SelectableChart",
    published: {
      // these published fields should not be overridden
      processedData: null,
      groupByField: undefined,
      filterField: "",
      value: null, // the backing collection

      // these ones can/should be overridden (although some have sensible defaults)
      chartTitle: "_chartTitle".loc(),
      collection: "", // {String} e.g. "XM.IncidentListItemCollection"
      drillDownRecordType: "",
      drillDownAttr: "",
      filterOptions: [], // these filters will be applied within the browser to the raw data from the fetch
      groupByOptions: [],
      query: {}, // if we want an initial filter on the collection fetch
      totalField: "" // what are we summing up in the bar chart (empty means just count)
    },
    components: [
      {name: "chartTitle", style: "color: white; margin-left: 100px; " },
      {name: "chart", components: [
        {name: "svg", tag: "svg"} // this is the DOM element that d3 will take over
      ]},
      {kind: "enyo.FittableColumns", components: [
        {content: "_filterOn".loc() + ": ", classes: "xv-picker-label",
          style: "color: white"},
        {kind: "onyx.PickerDecorator", onSelect: "filterSelected",
            classes: "xv-input-decorator", components: [
          {content: "_chooseOne".loc()},
          {kind: "onyx.Picker", name: "filterPicker" }
        ]},
        {content: "_groupBy".loc() + ": ", classes: "xv-picker-label",
          style: "color: white"},
        {kind: "onyx.PickerDecorator", onSelect: "groupBySelected", components: [
          {content: "_chooseOne".loc()},
          {kind: "onyx.Picker", name: "groupByPicker" }
        ]}
      ]}
    ],
    events: {
      onSearch: "",
      onWorkspace: ""
    },
    style: "padding-left: 30px; padding-top: 30px; color: white;", // TODO: put in LESS
    /**
      Get the grouped data in the JSON format the chart wants. Up to the implementation.
     */
    aggregateData: function (groupedData) {
      return groupedData;
    },
    /**
      Kick off the fetch on the collection as soon as we start.
     */
    create: function () {
      this.inherited(arguments);

      var that = this,
        collection = this.getCollection(),
        Klass = collection ? XT.getObjectByName(collection) : false;

      //
      // Set the chart title
      //
      this.$.chartTitle.setContent(this.getChartTitle());

      //
      // Make and fetch the collection
      //
      if (!Klass) {
        console.log("Error: cannot find collection", collection);
        return;
      }

      this.setValue(new Klass());
      this.getValue().fetch({
        query: this.getQuery(),
        success: function (collection, results) {
          //
          // Populate the filter picker
          //
          _.each(that.getFilterOptions(), function (item) {
            item.content = item.content || ("_" + item.name).loc(); // default content
            that.$.filterPicker.createComponent(item);
          });

          //
          // Populate the groupBy picker
          //
          _.each(that.getGroupByOptions(), function (item) {
            item.content = item.content || ("_" + (item.name || "all")).loc(); // default content
            that.$.groupByPicker.createComponent(item);
          });

          //
          // Save the data results
          //
          that.processData();
        }
      });
    },
    /**
      If the user clicks on a bar we open up the SalesHistory list with the appropriate
      filter. When the user clicks on an list item we drill down further into the sales
      order.
     */
    drillDown: function (field, key) {
      var that = this,
        recordType = this.getValue().model.prototype.recordType,
        listKind = XV.getList(recordType),
        params = [{
          name: field,
          value: key
        }],
        callback = function (value) {
          // unless explicitly specified, we assume that we want to drill down
          // into the same model that is fuelling the report
          var drillDownRecordType = that.getDrillDownRecordType() ||
              that.getValue().model.prototype.recordType,
            drillDownAttribute = that.getDrillDownAttr() ||
              XT.getObjectByName(drillDownRecordType).prototype.idAttribute,
            id = value.get(drillDownAttribute);

          if (id) {
            that.doWorkspace({workspace: XV.getWorkspace(drillDownRecordType), id: id});
          }
          // TODO: do anything if id is not present?
        };

      if (this.getQuery().parameters) {
        // apply the query filter(s) to the search list
        params = _.union(params, this.getQuery().parameters);
      }

      // TODO: the search list will be filtered by the group-by selection
      // and the query filter, but it needs to be also filtered by the filter selection

      // TODO: the parameter widget sometimes has trouble finding our query requests
      this.doSearch({
        list: listKind,
        searchText: "",
        callback: callback,
        parameterItemValues: params,
        conditions: [],
        query: null
      });
    },
    /**
      It is up to the subkinds to implement whatever filter they see fit
      based on the backing collection and the choice of this.getFilterField().
    */
    filterData: function (data) {
      return data;
    },
    filterFieldChanged: function () {
      this.processData();
    },
    filterSelected: function (inSender, inEvent) {
      this.setFilterField(inEvent.originator.name);
    },
    groupByFieldChanged: function () {
      this.processData();
    },
    groupBySelected: function (inSender, inEvent) {
      this.setGroupByField(inEvent.originator.name);
    },
    /**
      Make the chart using v3 and nv.d3, working off our this.processedData.
     */
    plot: function () {
      // up to the implementation
    },
    /**
      Take the raw data and process it according to the specifiations
      dictated by the pickers.
     */
    processData: function () {
      if (!this.getValue().length ||
          !this.getFilterField() ||
          this.getGroupByField() === undefined) {
        // not ready to aggregate
        return;
      }
      var that = this,
        filteredData, groupedData, aggregatedData;

      // apply arbitrary filter as defined by subkind
      filteredData = this.filterData(this.getValue().models);

      // Group on the selected group-by field. This gets tricky
      // if the field is a submodel.
      groupedData = _.groupBy(filteredData, function (datum) {
        if (!that.getGroupByField() || !datum.get(that.getGroupByField())) {
          return null;
        } else if (typeof datum.get(that.getGroupByField()) === 'object') {
          return datum.get(that.getGroupByField()).id;
        } else {
          return datum.get(that.getGroupByField());
        }
      });

      // data aggregation will be different for each implementation
      aggregatedData = this.aggregateData(groupedData);

      this.setProcessedData(aggregatedData);
    },
    processedDataChanged: function () {
      this.plot();
    }
  });

  enyo.kind({
    name: "XV.BarChart",
    kind: "XV.SelectableChart",
    aggregateData: function (groupedData) {
      var that = this,
        aggregatedData = _.map(groupedData, function (datum, key) {
          var reduction = _.reduce(datum, function (memo, row) {
            // if the total field is not specified, we just count.
            var increment = that.getTotalField() ? row.get(that.getTotalField()) : 1;
            return {
              label: memo.label || "_none".loc(),
              value: memo.value + increment
            };
          }, {label: key, value: 0});
          return reduction;
        });
      return [{values: aggregatedData}];
    },
    /**
      Make the chart using v3 and nv.d3, working off our this.processedData.
     */
    plot: function () {
      var that = this,
        div = this.$.svg.hasNode();

      //nv.addGraph(function () {
      var chart = nv.models.discreteBarChart()
        .x(function (d) { return d.label; })
        .y(function (d) { return d.value; })
        .valueFormat(d3.format(',.0f'))
        .staggerLabels(true)
        .tooltips(false)
        .showValues(true)
        .width(400);

      chart.yAxis
        .tickFormat(d3.format(',.0f'));
      chart.margin({left: 80});

      d3.select(div)
        .datum(this.getProcessedData())
        .transition().duration(500)
        .call(chart);

      d3.selectAll(".nv-bar").on("click", function (bar, index) {
        that.drillDown(that.getGroupByField(), bar.label);
      });

        //nv.utils.windowResize(chart.update);
        //return chart;
      //});
    }
  });

  enyo.kind({
    name: "XV.TimeSeriesChart",
    kind: "XV.SelectableChart",
    published: {
      dateField: ""
    },
    /**
      This looks really complicated! I'm just binning the
      data into a histogram.
     */
    aggregateData: function (groupedData) {
      var that = this,
        now = new Date().getTime(),
        earliestDate = now, // won't be now for long
        dataPoints = _.reduce(groupedData, function (memo, group) {
          _.each(group, function (item) {
            var dateInt = item.get(that.getDateField()).getTime();
            earliestDate = Math.min(earliestDate, dateInt);
          });
          return memo + group.length;
        }, 0),
        binCount = Math.ceil(Math.sqrt(dataPoints)),
        binWidth = Math.ceil((now - earliestDate) / binCount),
        histoGroup = _.map(groupedData, function (group, groupKey) {
          var binnedData, summedData, hole, findHole, foundData;

          binnedData = _.groupBy(group, function (item) {
            var binNumber = Math.floor((item.get(that.getDateField()).getTime() - earliestDate) / binWidth);
            // we actually want to return the timestamp at the start of the bin, for later use
            return (binNumber * binWidth) + earliestDate;
          });
          summedData = _.map(binnedData, function (bin, binKey) {
            var binTotal = _.reduce(bin, function (memo, value, key) {
              return memo + value.get(that.getTotalField());
            }, 0);
            return {x: binKey, y: binTotal};
          });
          // plug in zeros for missing data. Necessary for nvd3 stacking.
          findHole = function (datum) {
            return datum.x === String(hole);
          };
          for (hole = earliestDate; hole <= now; hole += binWidth) {
            foundData = _.find(summedData, findHole);
            if (!foundData) {
              summedData.push({x: String(hole), y: 0});
            }
          }
          summedData = _.sortBy(summedData, function (data) {
            return data.x;
          });
          return {key: groupKey, values: summedData};
        });

      return histoGroup;
    },
    /**
      Make the chart using v3 and nv.d3, working off our this.processedData.
     */
    plot: function () {
      var that = this,
        div = this.$.svg.hasNode();

      var chart = nv.models.multiBarChart()
        .stacked(true);

      chart.xAxis
        .tickFormat(function (d) { return d3.time.format('%b %d %y')(new Date(Number(d))); });

      chart.yAxis
        .tickFormat(d3.format(',.0f'));
      chart.margin({left: 80});

      d3.select(div)
        .datum(this.getProcessedData())
        .transition().duration(500)
        .call(chart);
    },
  });

  // This one ended up not looking good for sales history, but it might
  // be useful somewhere else
  enyo.kind({
    name: "XV.TimeSeriesLineChart",
    kind: "XV.SelectableChart",
    published: {
      dateField: ""
    },
    aggregateData: function (groupedData) {
      var that = this;

      return _.map(groupedData, function (group, key) {
        var groupValues = _.map(group, function (modelData) {
          return {
            x: modelData.get(that.getDateField()).getTime(),
            y: modelData.get(that.getTotalField())
          };
        });

        return {
          key: key,
          values: groupValues
        };
      });
    },
    /**
      Make the chart using v3 and nv.d3, working off our this.processedData.
     */
    plot: function () {
      var that = this,
        div = this.$.svg.hasNode();

      var chart = nv.models.lineChart();
      chart.xAxis
        .tickFormat(function (d) { return d3.time.format('%b %d %y')(new Date(d)); });

      d3.select(div)
        .datum(this.getProcessedData())
        .transition().duration(500)
        .call(chart);
    },
  });

}());